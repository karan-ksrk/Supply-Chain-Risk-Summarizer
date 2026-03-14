"""
core/risk_analyzer.py
---------------------
Step 3 of the smart pipeline:
  Batched LLM risk analysis for affected shipments.
"""

import json
import math
import os
from collections.abc import Callable
from typing import Any

from backend.providers.llm import call_llm, parse_json_response

DEFAULT_RISK_BATCH_SIZE = max(1, int(os.getenv("RISK_ANALYSIS_BATCH_SIZE", "4")))

SYSTEM_PROMPT = """You are a senior supply chain risk analyst.
Given shipments and relevant news risk signals, assess risk clearly and concisely.
Always respond with valid JSON only. No explanation, no markdown."""

SINGLE_ANALYSIS_PROMPT = """
Analyze the risk for this shipment based on the news signals provided.

SHIPMENT DETAILS:
{shipment_json}

MATCHED RISK SIGNALS FROM NEWS:
{signals_json}

Return this exact JSON:
{{
  "shipment_id": "same as input",
  "risk_level": "HIGH | MEDIUM | LOW",
  "delay_estimate": "e.g. +3 to +5 days, or None",
  "primary_risk": "one sentence — the main risk driving this assessment",
  "explanation": "2-3 sentences explaining why this shipment is affected",
  "suggested_action": "one clear recommended action for the logistics team",
  "confidence": "HIGH | MEDIUM | LOW"
}}
"""

BATCH_ANALYSIS_PROMPT = """
Analyze shipment risk for each item in this JSON array:
{shipments_json}

Return strict JSON in this exact shape:
{{
  "results": [
    {{
      "analysis_index": 1,
      "shipment_id": "same as input",
      "risk_level": "HIGH | MEDIUM | LOW",
      "delay_estimate": "e.g. +3 to +5 days, or None",
      "primary_risk": "one sentence — the main risk driving this assessment",
      "explanation": "2-3 sentences explaining why this shipment is affected",
      "suggested_action": "one clear recommended action for the logistics team",
      "confidence": "HIGH | MEDIUM | LOW"
    }}
  ]
}}

Rules:
- Include exactly one result object for every input analysis_index.
- Keep analysis_index unchanged.
- shipment_id must match the input shipment_id for that analysis_index.
"""


def _chunked(items: list[Any], size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _enrich_report(report: dict, shipment: dict, signals: list[dict]) -> dict:
    enriched = {**report}
    # Trust pipeline shipment identity over model output for DB consistency.
    enriched["shipment_id"] = shipment.get("shipment_id")

    risk_level = str(enriched.get("risk_level", "LOW") or "LOW").strip().upper()
    if risk_level not in {"HIGH", "MEDIUM", "LOW"}:
        risk_level = "LOW"
    enriched["risk_level"] = risk_level

    confidence = str(enriched.get("confidence", "LOW") or "LOW").strip().upper()
    if confidence not in {"HIGH", "MEDIUM", "LOW"}:
        confidence = "LOW"
    enriched["confidence"] = confidence

    delay_estimate = enriched.get("delay_estimate")
    if delay_estimate is None:
        enriched["delay_estimate"] = "None"
    elif str(delay_estimate).strip().lower() == "none":
        enriched["delay_estimate"] = "None"

    enriched["vendor"] = shipment.get("vendor", "")
    enriched["origin"] = f"{shipment.get('origin_city')} → {shipment.get('dest_city')}"
    enriched["route"] = shipment.get("route", "")
    enriched["eta"] = shipment.get("eta", "")
    enriched["carrier"] = shipment.get("carrier", "")
    enriched["sku"] = shipment.get("sku", "")
    enriched["matched_signals"] = signals
    return enriched


def _parse_batch_results(parsed: Any) -> list[dict]:
    if isinstance(parsed, dict):
        results = parsed.get("results", [])
    elif isinstance(parsed, list):
        results = parsed
    else:
        raise ValueError("Batch analysis response is not a list/object with results.")
    if not isinstance(results, list):
        raise ValueError("Batch analysis results must be a list.")
    return [r for r in results if isinstance(r, dict)]


def analyze_single_shipment_risk(shipment: dict) -> dict:
    """Run one LLM risk analysis call for a single affected shipment."""
    shipment_copy = shipment.copy()
    signals = shipment_copy.pop("matched_signals", [])
    shipment_clean = {k: v for k, v in shipment_copy.items()}

    prompt = SINGLE_ANALYSIS_PROMPT.format(
        shipment_json=json.dumps(shipment_clean, indent=2),
        signals_json=json.dumps(signals, indent=2),
    )
    raw = call_llm(prompt=prompt, system=SYSTEM_PROMPT, expect_json=True)
    report = parse_json_response(raw)
    if not isinstance(report, dict):
        raise ValueError("LLM did not return a risk report object.")
    return _enrich_report(report, shipment, signals)


def analyze_risks_batch(indexed_shipments: list[tuple[int, dict]]) -> dict[int, dict]:
    """
    Run one batched LLM call for multiple affected shipments.
    Returns mapping: analysis_index -> base report (not enriched).
    """
    payload: list[dict] = []
    for idx, shipment in indexed_shipments:
        shipment_copy = shipment.copy()
        signals = shipment_copy.pop("matched_signals", [])
        payload.append({
            "analysis_index": idx,
            "shipment": shipment_copy,
            "matched_signals": signals,
        })

    raw = call_llm(
        prompt=BATCH_ANALYSIS_PROMPT.format(
            shipments_json=json.dumps(payload, indent=2),
        ),
        system=SYSTEM_PROMPT,
        expect_json=True,
    )
    parsed = parse_json_response(raw)
    results = _parse_batch_results(parsed)

    mapped: dict[int, dict] = {}
    for result in results:
        analysis_index = result.get("analysis_index")
        if isinstance(analysis_index, int):
            mapped[analysis_index] = result
    return mapped


def analyze_risks(
    affected_shipments: list[dict],
    on_report_processed: Callable[[dict[str, Any]], None] | None = None,
    on_report_started: Callable[[dict[str, Any]], None] | None = None,
    batch_size: int = DEFAULT_RISK_BATCH_SIZE,
) -> list[dict]:
    """
    Runs batched LLM risk analysis.
    Falls back to single-item analysis for malformed/missing batch outputs.
    """
    safe_batch_size = max(1, int(batch_size))
    total = len(affected_shipments)
    estimated_calls = math.ceil(total / safe_batch_size) if total else 0
    print(
        f"🤖 Running LLM risk analysis on {total} affected shipments "
        f"(batch_size={safe_batch_size}, ~{estimated_calls} LLM calls)..."
    )

    results: list[dict] = []
    indexed_shipments = list(enumerate(affected_shipments, start=1))

    for chunk in _chunked(indexed_shipments, safe_batch_size):
        chunk_label = f"{chunk[0][0]}-{chunk[-1][0]}"
        for idx, shipment in chunk:
            if on_report_started:
                on_report_started({
                    "index": idx,
                    "total": total,
                    "shipment_id": shipment.get("shipment_id"),
                })

        try:
            mapped = analyze_risks_batch(chunk)
        except Exception as batch_error:
            print(f"   [batch {chunk_label}] ✗ Batch analysis failed: {batch_error}")
            mapped = {}

        for idx, shipment in chunk:
            try:
                base_report = mapped.get(idx)
                if base_report is None:
                    report = analyze_single_shipment_risk(shipment)
                else:
                    signals = shipment.get("matched_signals", [])
                    report = _enrich_report(base_report, shipment, signals)

                results.append(report)
                risk = report.get("risk_level", "?")
                sid = report.get("shipment_id", shipment.get("shipment_id", "?"))
                delay = report.get("delay_estimate", "N/A")
                print(f"   [{idx}/{total}] {sid} → {risk} RISK | Delay: {delay}")
                if on_report_processed:
                    on_report_processed({
                        "index": idx,
                        "total": total,
                        "report": report,
                    })
            except Exception as e:
                print(f"   [{idx}/{total}] ✗  Analysis failed for {shipment.get('shipment_id', '?')}: {e}")
                if on_report_processed:
                    on_report_processed({
                        "index": idx,
                        "total": total,
                        "shipment_id": shipment.get("shipment_id"),
                        "error": str(e),
                    })

    print(f"\n   → {len(results)} risk reports generated\n")
    return results
