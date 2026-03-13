"""
main.py
-------
Entry point for the Supply Chain Risk Summarizer pipeline.

Run:
  python main.py                    # uses sample shipments + live news
  python main.py --csv my_data.csv  # uses your own CSV
  python main.py --mock-news        # uses mock news (no internet needed)
"""

from core.risk_analyzer import analyze_risks
from core.shipment_matcher import match_shipments_to_signals
from core.signal_extractor import extract_signals
from core.news_fetcher import fetch_news
from data.shipments import SAMPLE_SHIPMENTS, load_shipments_from_csv
import json
import argparse
from datetime import datetime
from colorama import Fore, Style, init

init(autoreset=True)


# ── Mock news for offline testing ───────────────────────────
MOCK_NEWS = [
    {
        "title": "Houthi attacks force vessels to reroute away from Red Sea",
        "description": "Dozens of container ships have rerouted via Cape of Good Hope adding 10-14 days to Asia-Europe transit times. Maersk Line and CMA CGM confirm diversions.",
        "source": "FreightWaves", "published_at": "2026-03-09", "url": ""
    },
    {
        "title": "LA dockworkers vote to slow operations at Port of Los Angeles",
        "description": "ILWU members at the Port of LA and Long Beach are slowing cargo operations. Trans-Pacific shipments expect 3-5 day delays.",
        "source": "JOC", "published_at": "2026-03-09", "url": ""
    },
    {
        "title": "Frankfurt Airport cargo terminal facing staff shortage",
        "description": "Ground handling staff shortage at Frankfurt Airport is causing air freight clearance delays of 1-2 days for inbound cargo.",
        "source": "Air Cargo News", "published_at": "2026-03-08", "url": ""
    },
]


def print_banner():
    print(f"\n{Fore.CYAN}{'═'*60}")
    print(f"  ⬡  SUPPLY CHAIN RISK SUMMARIZER")
    print(f"     Powered by LLM + Smart Filtering")
    print(f"{'═'*60}{Style.RESET_ALL}\n")


def print_results(risk_reports: list[dict]):
    colors = {"HIGH": Fore.RED, "MEDIUM": Fore.YELLOW, "LOW": Fore.GREEN}

    print(f"\n{Fore.CYAN}{'═'*60}")
    print(f"  RISK ANALYSIS RESULTS  —  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'═'*60}{Style.RESET_ALL}\n")

    if not risk_reports:
        print(f"{Fore.GREEN}  ✓ No shipments affected by current news signals.{Style.RESET_ALL}\n")
        return

    for r in sorted(risk_reports, key=lambda x: ["HIGH", "MEDIUM", "LOW"].index(x.get("risk_level", "LOW"))):
        level = r.get("risk_level", "?")
        color = colors.get(level, Fore.WHITE)

        print(f"{color}  ▶ {r['shipment_id']}  [{level} RISK]{Style.RESET_ALL}")
        print(f"    Vendor  : {r.get('vendor', '')}")
        print(f"    Route   : {r.get('origin', '')}  ({r.get('route', '')})")
        print(f"    ETA     : {r.get('eta', '')}  |  Delay: {color}{r.get('delay_estimate', 'N/A')}{Style.RESET_ALL}")
        print(f"    Risk    : {r.get('primary_risk', '')}")
        print(f"    Action  : {Fore.CYAN}{r.get('suggested_action', '')}{Style.RESET_ALL}")
        print(f"    Signals : {len(r.get('matched_signals', []))} news signal(s) matched")
        print()


def save_results(risk_reports: list[dict], filename: str = "outputs/risk_report.json"):
    import os
    os.makedirs("outputs", exist_ok=True)
    with open(filename, "w") as f:
        json.dump({
            "generated_at": datetime.now().isoformat(),
            "total_risks_found": len(risk_reports),
            "reports": risk_reports
        }, f, indent=2)
    print(f"{Fore.CYAN}  💾 Full report saved to: {filename}{Style.RESET_ALL}\n")


def main():
    parser = argparse.ArgumentParser(description="Supply Chain Risk Summarizer")
    parser.add_argument("--csv", help="Path to shipment CSV file")
    parser.add_argument("--mock-news", action="store_true", help="Use mock news (no internet)")
    args = parser.parse_args()

    print_banner()

    # ── Step 0: Load shipments ───────────────────────────────
    if args.csv:
        print(f"📦 Loading shipments from CSV: {args.csv}")
        shipments = load_shipments_from_csv(args.csv)
    else:
        print(f"📦 Using {len(SAMPLE_SHIPMENTS)} sample shipments")
        shipments = [s.copy() for s in SAMPLE_SHIPMENTS]
    print()

    # ── Step 1: Fetch news ───────────────────────────────────
    if args.mock_news:
        print("📡 Using mock news articles (--mock-news flag set)")
        articles = MOCK_NEWS
    else:
        articles = fetch_news(max_articles=15, shipments=shipments)

    # ── Step 2: Extract risk signals (1 LLM call per article)
    signals = extract_signals(articles)
    if not signals:
        print(f"{Fore.GREEN}No relevant risk signals found in today's news.{Style.RESET_ALL}")
        return

    # ── Step 3: Match shipments (pure Python, zero LLM cost) ─
    affected = match_shipments_to_signals(shipments, signals)
    if not affected:
        print(f"{Fore.GREEN}No shipments affected by current risk signals.{Style.RESET_ALL}")
        return

    # ── Step 4: Analyze risk (1 LLM call per affected shipment)
    risk_reports = analyze_risks(affected)

    # ── Step 5: Print + save results ─────────────────────────
    print_results(risk_reports)
    save_results(risk_reports)

    # ── Summary ──────────────────────────────────────────────
    high = sum(1 for r in risk_reports if r.get("risk_level") == "HIGH")
    med = sum(1 for r in risk_reports if r.get("risk_level") == "MEDIUM")
    low = sum(1 for r in risk_reports if r.get("risk_level") == "LOW")

    print(f"{Fore.CYAN}  SUMMARY{Style.RESET_ALL}")
    print(f"  Total shipments checked : {len(shipments)}")
    print(f"  Affected shipments      : {len(risk_reports)}")
    print(f"  {Fore.RED}HIGH{Style.RESET_ALL}   : {high}  |  {Fore.YELLOW}MEDIUM{Style.RESET_ALL}: {med}  |  {Fore.GREEN}LOW{Style.RESET_ALL}: {low}")
    total_llm_calls = len(articles) + len(affected)
    naive_calls = len(shipments) * len(articles)
    print(
        f"\n  LLM calls used   : {total_llm_calls}  (vs {naive_calls} naive — {round((1 - total_llm_calls/naive_calls)*100)}% saved)\n")


if __name__ == "__main__":
    main()
