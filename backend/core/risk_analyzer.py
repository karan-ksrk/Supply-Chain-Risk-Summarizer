"""
core/risk_analyzer.py
---------------------
Step 3 of the smart pipeline:
  One LLM call per affected shipment.
  Takes shipment data + matched signals → returns structured risk report.
"""

import json
from collections.abc import Callable
from typing import Any

from backend.providers.llm import call_llm, parse_json_response

SYSTEM_PROMPT = """You are a senior supply chain risk analyst.
Given a shipment and relevant news risk signals, assess the risk clearly and concisely.
Always respond with valid JSON only. No explanation, no markdown."""

ANALYSIS_PROMPT = """
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


def analyze_single_shipment_risk(shipment: dict) -> dict:
    """Run one LLM risk analysis call for a single affected shipment."""
    shipment_copy = shipment.copy()
    signals = shipment_copy.pop("matched_signals", [])
    shipment_clean = {k: v for k, v in shipment_copy.items()}

    prompt = ANALYSIS_PROMPT.format(
        shipment_json=json.dumps(shipment_clean, indent=2),
        signals_json=json.dumps(signals, indent=2),
    )

    raw = call_llm(prompt=prompt, system=SYSTEM_PROMPT, expect_json=True)
    report = parse_json_response(raw)

    report["vendor"] = shipment.get("vendor", "")
    report["origin"] = f"{shipment.get('origin_city')} → {shipment.get('dest_city')}"
    report["route"] = shipment.get("route", "")
    report["eta"] = shipment.get("eta", "")
    report["carrier"] = shipment.get("carrier", "")
    report["sku"] = shipment.get("sku", "")
    report["matched_signals"] = signals
    return report


def analyze_risks(
    affected_shipments: list[dict],
    on_report_processed: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict]:
    """
    Runs LLM risk analysis on each affected shipment.
    Returns list of risk reports.
    """
    print(f"🤖 Running LLM risk analysis on {len(affected_shipments)} affected shipments...")

    results = []

    total = len(affected_shipments)

    for i, shipment in enumerate(affected_shipments):
        try:
            report = analyze_single_shipment_risk(shipment)
            results.append(report)

            risk = report.get("risk_level", "?")
            sid = report.get("shipment_id", "?")
            delay = report.get("delay_estimate", "N/A")
            print(f"   [{i+1}] {sid} → {risk} RISK | Delay: {delay}")
            if on_report_processed:
                on_report_processed({
                    "index": i + 1,
                    "total": total,
                    "report": report,
                })

        except Exception as e:
            print(f"   [{i+1}] ✗  Analysis failed for {shipment.get('shipment_id', '?')}: {e}")
            if on_report_processed:
                on_report_processed({
                    "index": i + 1,
                    "total": total,
                    "shipment_id": shipment.get("shipment_id"),
                    "error": str(e),
                })
            continue

    print(f"\n   → {len(results)} risk reports generated\n")
    return results
