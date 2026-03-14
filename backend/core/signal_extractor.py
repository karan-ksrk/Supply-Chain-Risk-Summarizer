"""
core/signal_extractor.py
------------------------
Step 1 of the smart pipeline:
  One LLM call per news article → extract structured risk signals.
  These signals are later used for pure Python matching (no LLM cost per shipment).
"""

from collections.abc import Callable
from typing import Any

from backend.providers.llm import call_llm, parse_json_response

SYSTEM_PROMPT = """You are a logistics risk signal extractor. 
Given a news article, extract structured risk signals relevant to supply chains.
Always respond with valid JSON only. No explanation, no markdown."""

EXTRACTION_PROMPT = """
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


def extract_signal(article: dict) -> dict | None:
    """
    Extract a single structured signal from one article.
    Returns None when article is not logistics-relevant.
    """
    prompt = EXTRACTION_PROMPT.format(
        title=article["title"],
        description=article.get("description", "No description available"),
    )

    raw = call_llm(prompt=prompt, system=SYSTEM_PROMPT, expect_json=True)
    signal = parse_json_response(raw)

    if not signal.get("is_logistics_relevant", False):
        return None

    signal["source_title"] = article["title"]
    signal["source_url"] = article.get("url", "")
    signal["published_at"] = article.get("published_at", "")
    signal["source"] = article.get("source", "")
    return signal


def extract_signals(
    articles: list[dict],
    on_article_processed: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict]:
    """
    Runs one LLM call per article to extract structured signals.
    Filters out non-logistics articles automatically.
    Returns only relevant signals.
    """
    signals = []

    print(f"🔍 Extracting risk signals from {len(articles)} articles...")

    total = len(articles)

    for i, article in enumerate(articles):
        try:
            signal = extract_signal(article)

            if signal is None:
                print(f"   [{i+1}] ⏭  Skipped (not logistics-relevant): {article['title'][:60]}...")
                if on_article_processed:
                    on_article_processed({
                        "index": i + 1,
                        "total": total,
                        "relevant": False,
                        "article_title": article.get("title", ""),
                    })
                continue

            signals.append(signal)
            print(f"   [{i+1}] ✓  {signal['severity']} | {signal['risk_type']} | {article['title'][:55]}...")
            if on_article_processed:
                on_article_processed({
                    "index": i + 1,
                    "total": total,
                    "relevant": True,
                    "signal": signal,
                })

        except Exception as e:
            print(f"   [{i+1}] ✗  Failed to extract signal: {e}")
            if on_article_processed:
                on_article_processed({
                    "index": i + 1,
                    "total": total,
                    "relevant": False,
                    "error": str(e),
                    "article_title": article.get("title", ""),
                })
            continue

    print(f"\n   → {len(signals)} relevant risk signals extracted\n")
    return signals
