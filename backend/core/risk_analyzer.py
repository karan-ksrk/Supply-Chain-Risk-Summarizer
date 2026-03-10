"""
core/risk_analyzer.py
---------------------
Step 3 of the smart pipeline:
  One LLM call per affected shipment.
  Takes shipment data + matched signals → returns structured risk report.
"""

import json
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


def analyze_risks(affected_shipments: list[dict]) -> list[dict]:
    """
    Runs LLM risk analysis on each affected shipment.
    Returns list of risk reports.
    """
    print(f"🤖 Running LLM risk analysis on {len(affected_shipments)} affected shipments...")

    results = []

    for i, shipment in enumerate(affected_shipments):
        try:
            # Remove matched_signals from shipment copy before sending (keep it clean)
            signals = shipment.pop("matched_signals", [])
            shipment_clean = {k: v for k, v in shipment.items()}

            prompt = ANALYSIS_PROMPT.format(
                shipment_json=json.dumps(shipment_clean, indent=2),
                signals_json=json.dumps(signals, indent=2),
            )

            raw = call_llm(prompt=prompt, system=SYSTEM_PROMPT, expect_json=True)
            report = parse_json_response(raw)

            # Attach original shipment fields + signals to the report
            report["vendor"] = shipment.get("vendor", "")
            report["origin"] = f"{shipment.get('origin_city')} → {shipment.get('dest_city')}"
            report["route"] = shipment.get("route", "")
            report["eta"] = shipment.get("eta", "")
            report["carrier"] = shipment.get("carrier", "")
            report["sku"] = shipment.get("sku", "")
            report["matched_signals"] = signals   # put back for output

            results.append(report)

            risk = report.get("risk_level", "?")
            sid = report.get("shipment_id", "?")
            delay = report.get("delay_estimate", "N/A")
            print(f"   [{i+1}] {sid} → {risk} RISK | Delay: {delay}")

        except Exception as e:
            print(f"   [{i+1}] ✗  Analysis failed for {shipment.get('shipment_id', '?')}: {e}")
            continue

    print(f"\n   → {len(results)} risk reports generated\n")
    return results
