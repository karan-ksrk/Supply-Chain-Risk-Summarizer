"""
core/signal_extractor.py
------------------------
Step 1 of the smart pipeline:
  Batched LLM extraction from news articles.
"""

import json
import math
import os
from collections.abc import Callable
from typing import Any

from backend.providers.llm import call_llm, parse_json_response

DEFAULT_SIGNAL_BATCH_SIZE = max(1, int(os.getenv("SIGNAL_EXTRACTION_BATCH_SIZE", "5")))

SYSTEM_PROMPT = """You are a logistics risk signal extractor.
Given one or more news articles, extract structured risk signals relevant to supply chains.
Always respond with valid JSON only. No explanation, no markdown."""

SINGLE_EXTRACTION_PROMPT = """
Extract supply chain risk signals from this news article.

Article Title: {title}
Article Description: {description}

Return this exact JSON structure:
{{
  "is_logistics_relevant": true or false,
  "risk_type": "PORT_STRIKE | WEATHER | GEOPOLITICAL | CUSTOMS | INFRASTRUCTURE | OTHER",
  "severity": "HIGH | MEDIUM | LOW",
  "affected_ports": ["list of port names mentioned, e.g. Port of LA, Rotterdam"],
  "affected_cities": ["list of cities mentioned"],
  "affected_countries": ["list of countries mentioned"],
  "affected_routes": ["e.g. Trans-Pacific, Red Sea, Suez Canal, Asia-Europe"],
  "affected_carriers": ["carrier/shipping line names if mentioned"],
  "summary": "one sentence plain English summary of the risk"
}}

If the article is not relevant to logistics or supply chain, set is_logistics_relevant to false
and use empty arrays for all list fields.
"""

BATCH_EXTRACTION_PROMPT = """
Extract supply chain risk signals for each article in this JSON array:
{articles_json}

Return strict JSON in this exact shape:
{{
  "results": [
    {{
      "article_index": 1,
      "is_logistics_relevant": true or false,
      "risk_type": "PORT_STRIKE | WEATHER | GEOPOLITICAL | CUSTOMS | INFRASTRUCTURE | OTHER",
      "severity": "HIGH | MEDIUM | LOW",
      "affected_ports": ["..."],
      "affected_cities": ["..."],
      "affected_countries": ["..."],
      "affected_routes": ["..."],
      "affected_carriers": ["..."],
      "summary": "..."
    }}
  ]
}}

Rules:
- Include exactly one result object for every input article_index.
- Keep article_index unchanged.
- If not logistics-relevant, set is_logistics_relevant=false and all arrays empty.
"""


def _chunked(items: list[Any], size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _normalize_signal_payload(signal: dict, article: dict) -> dict | None:
    if not signal.get("is_logistics_relevant", False):
        return None
    return {
        **signal,
        "source_title": article.get("title", ""),
        "source_url": article.get("url", ""),
        "published_at": article.get("published_at", ""),
        "source": article.get("source", ""),
    }


def _parse_batch_results(parsed: Any) -> list[dict]:
    if isinstance(parsed, dict):
        results = parsed.get("results", [])
    elif isinstance(parsed, list):
        results = parsed
    else:
        raise ValueError("Batch extraction response is not a list/object with results.")

    if not isinstance(results, list):
        raise ValueError("Batch extraction results must be a list.")
    return [r for r in results if isinstance(r, dict)]


def extract_signal(article: dict) -> dict | None:
    """
    Extract a single structured signal from one article.
    Returns None when article is not logistics-relevant.
    """
    prompt = SINGLE_EXTRACTION_PROMPT.format(
        title=article.get("title", ""),
        description=article.get("description", "No description available"),
    )
    raw = call_llm(prompt=prompt, system=SYSTEM_PROMPT, expect_json=True)
    signal = parse_json_response(raw)
    if not isinstance(signal, dict):
        raise ValueError("LLM did not return a signal object.")
    return _normalize_signal_payload(signal, article)


def extract_signals_batch(indexed_articles: list[tuple[int, dict]]) -> dict[int, dict | None]:
    """
    Run one batched LLM call for multiple articles.
    Returns mapping: article_index -> normalized signal or None.
    """
    article_lookup = {idx: article for idx, article in indexed_articles}
    payload = [
        {
            "article_index": idx,
            "title": article.get("title", ""),
            "description": article.get("description", "No description available"),
        }
        for idx, article in indexed_articles
    ]
    raw = call_llm(
        prompt=BATCH_EXTRACTION_PROMPT.format(
            articles_json=json.dumps(payload, indent=2),
        ),
        system=SYSTEM_PROMPT,
        expect_json=True,
    )
    parsed = parse_json_response(raw)
    results = _parse_batch_results(parsed)

    mapped: dict[int, dict | None] = {}
    for result in results:
        article_index = result.get("article_index")
        if not isinstance(article_index, int):
            continue
        article = article_lookup.get(article_index)
        if not article:
            continue
        mapped[article_index] = _normalize_signal_payload(result, article)
    return mapped


def extract_signals(
    articles: list[dict],
    on_article_processed: Callable[[dict[str, Any]], None] | None = None,
    batch_size: int = DEFAULT_SIGNAL_BATCH_SIZE,
) -> list[dict]:
    """
    Runs batched LLM calls to extract structured signals.
    Falls back to single-item extraction for malformed/missing batch outputs.
    """
    safe_batch_size = max(1, int(batch_size))
    total = len(articles)
    estimated_calls = math.ceil(total / safe_batch_size) if total else 0
    print(
        f"🔍 Extracting risk signals from {total} articles "
        f"(batch_size={safe_batch_size}, ~{estimated_calls} LLM calls)..."
    )

    signals: list[dict] = []
    indexed_articles = list(enumerate(articles, start=1))

    for chunk in _chunked(indexed_articles, safe_batch_size):
        chunk_label = f"{chunk[0][0]}-{chunk[-1][0]}"
        try:
            mapped = extract_signals_batch(chunk)
        except Exception as batch_error:
            print(f"   [batch {chunk_label}] ✗ Batch extraction failed: {batch_error}")
            mapped = {}

        for idx, article in chunk:
            try:
                signal = mapped.get(idx) if idx in mapped else extract_signal(article)

                if signal is None:
                    print(f"   [{idx}/{total}] ⏭  Skipped (not logistics-relevant): {article.get('title', '')[:60]}...")
                    if on_article_processed:
                        on_article_processed({
                            "index": idx,
                            "total": total,
                            "relevant": False,
                            "article_title": article.get("title", ""),
                        })
                    continue

                signals.append(signal)
                print(f"   [{idx}/{total}] ✓  {signal.get('severity', '?')} | {signal.get('risk_type', '?')} | {article.get('title', '')[:55]}...")
                if on_article_processed:
                    on_article_processed({
                        "index": idx,
                        "total": total,
                        "relevant": True,
                        "signal": signal,
                    })

            except Exception as e:
                print(f"   [{idx}/{total}] ✗  Failed to extract signal: {e}")
                if on_article_processed:
                    on_article_processed({
                        "index": idx,
                        "total": total,
                        "relevant": False,
                        "error": str(e),
                        "article_title": article.get("title", ""),
                    })

    print(f"\n   → {len(signals)} relevant risk signals extracted\n")
    return signals
