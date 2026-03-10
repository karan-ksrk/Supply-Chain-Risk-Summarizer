"""
core/shipment_matcher.py
------------------------
Step 2 of the smart pipeline:
  Pure Python matching — no LLM calls here.
  Matches news risk signals against shipment fields.
  Only affected shipments proceed to the LLM risk analysis step.
"""


def match_shipments_to_signals(shipments: list[dict], signals: list[dict]) -> list[dict]:
    """
    For each shipment, finds all signals that are relevant to it.
    Returns only shipments that have at least one matching signal,
    with the matched signals attached.
    """
    print("🔗 Matching shipments to risk signals (pure Python, no LLM)...")

    affected = []

    for shipment in shipments:
        matched_signals = []

        for signal in signals:
            if _is_affected(shipment, signal):
                matched_signals.append(signal)

        if matched_signals:
            shipment_copy = shipment.copy()
            shipment_copy["matched_signals"] = matched_signals
            affected.append(shipment_copy)

    print(f"   → {len(affected)} / {len(shipments)} shipments matched to risk signals\n")
    return affected


def _is_affected(shipment: dict, signal: dict) -> bool:
    """
    Returns True if any shipment field matches any signal field.
    Case-insensitive substring matching.
    """
    # Fields from the shipment to check
    shipment_terms = _extract_shipment_terms(shipment)

    # Fields from the signal to match against
    signal_terms = _extract_signal_terms(signal)

    for s_term in shipment_terms:
        for sig_term in signal_terms:
            if s_term and sig_term and sig_term.lower() in s_term.lower():
                return True
            if s_term and sig_term and s_term.lower() in sig_term.lower():
                return True

    return False


def _extract_shipment_terms(shipment: dict) -> list[str]:
    """Pull all location/route/carrier terms from a shipment row."""
    return [
        shipment.get("origin_city", ""),
        shipment.get("origin_country", ""),
        shipment.get("dest_city", ""),
        shipment.get("dest_country", ""),
        shipment.get("origin_port", ""),
        shipment.get("dest_port", ""),
        shipment.get("carrier", ""),
        shipment.get("route", ""),
        shipment.get("transport_mode", ""),
    ]


def _extract_signal_terms(signal: dict) -> list[str]:
    """Flatten all location terms from a signal into a single list."""
    terms = []
    terms.extend(signal.get("affected_ports", []))
    terms.extend(signal.get("affected_cities", []))
    terms.extend(signal.get("affected_countries", []))
    terms.extend(signal.get("affected_routes", []))
    terms.extend(signal.get("affected_carriers", []))
    return [t for t in terms if t]  # filter empty strings
