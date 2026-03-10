"""
backend/server.py — FastAPI + PostgreSQL
"""

from contextlib import asynccontextmanager
import io
import csv
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.news_fetcher import fetch_news
from backend.core.risk_analyzer import analyze_risks
from backend.core.shipment_matcher import match_shipments_to_signals
from backend.core.signal_extractor import extract_signals
from backend.data.shipments import SAMPLE_SHIPMENTS
from backend.db import crud
from backend.db.database import get_db, init_db
from backend.providers.llm import PROVIDER

_is_running = False

MOCK_NEWS = [
    {"title": "Houthi attacks force vessels to reroute away from Red Sea",
        "description": "Dozens of container ships rerouted via Cape of Good Hope adding 10-14 days to Asia-Europe transit. Maersk Line and CMA CGM confirm diversions.", "source": "FreightWaves", "published_at": "2026-03-09", "url": ""},
    {"title": "LA dockworkers vote to slow operations at Port of Los Angeles",
        "description": "ILWU members slowing cargo ops at Port of LA and Long Beach. Trans-Pacific shipments expect 3-5 day delays.", "source": "JOC", "published_at": "2026-03-09", "url": ""},
    {"title": "Frankfurt Airport cargo terminal facing staff shortage", "description": "Ground handling shortage at Frankfurt Airport causing 1-2 day delays for inbound air freight clearance.",
        "source": "Air Cargo News", "published_at": "2026-03-08", "url": ""},
    {"title": "Cyclone warning issued for Arabian Sea shipping lanes", "description": "IMD issues cyclone warning affecting vessels between Mumbai, Nhava Sheva and Gulf ports.",
        "source": "Lloyd's List", "published_at": "2026-03-09", "url": ""},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    db = next(get_db())
    try:
        if not crud.get_all_shipments(db):
            crud.upsert_shipments(db, SAMPLE_SHIPMENTS)
            print(f"Seeded {len(SAMPLE_SHIPMENTS)} sample shipments")
        yield
    finally:
        db.close()


app = FastAPI(title="Supply Chain Risk API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class AnalyzeRequest(BaseModel):
    use_mock_news: bool = False
    max_articles: int = 15


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    latest = crud.get_latest_run(db)
    return {
        "status": "ok",
        "llm_provider": PROVIDER,
        "shipment_count": len(crud.get_all_shipments(db)),
        "last_run": latest.run_at.isoformat() if latest else None,
    }


@app.get("/api/shipments")
def get_shipments(db: Session = Depends(get_db)):
    shipments = crud.get_all_shipments(db)
    return {"shipments": [_s(s) for s in shipments], "count": len(shipments)}


@app.get("/api/shipments/{shipment_id}")
def get_shipment(shipment_id: str, db: Session = Depends(get_db)):
    s = crud.get_shipment(db, shipment_id)
    if not s:
        raise HTTPException(404, f"Shipment {shipment_id} not found")
    history = crud.get_risk_history_for_shipment(db, shipment_id)
    return {"shipment": _s(s), "risk_history": [_r(r) for r in history]}


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest, db: Session = Depends(get_db)):
    global _is_running
    if _is_running:
        raise HTTPException(409, "Analysis already running.")
    _is_running = True
    run = crud.create_run(db, llm_provider=PROVIDER, used_mock_news=req.use_mock_news)

    try:
        shipments = [_s(s) for s in crud.get_all_shipments(db)]
        articles = MOCK_NEWS if req.use_mock_news else fetch_news(req.max_articles)
        signals = extract_signals(articles)

        if not signals:
            crud.complete_run(db, run, _empty_stats(shipments, articles), status="no_signals")
            return {"status": "no_signals", "run_id": run.id, "risk_reports": [], "signals": []}

        crud.save_signals(db, run.id, signals)
        affected = match_shipments_to_signals([s.copy() for s in shipments], signals)

        if not affected:
            crud.complete_run(db, run, {**_empty_stats(shipments, articles),
                              "signals_extracted": len(signals)}, status="no_affected")
            return {"status": "no_affected", "run_id": run.id, "risk_reports": [], "signals": signals}

        risk_reports = analyze_risks(affected)
        crud.save_risk_reports(db, run.id, risk_reports)
        stats = _build_stats(risk_reports, shipments, articles, signals)
        crud.complete_run(db, run, stats)

        return {"status": "success", "run_id": run.id, "generated_at": run.run_at.isoformat(), "risk_reports": risk_reports, "signals": signals, "stats": stats}

    except Exception as e:
        crud.complete_run(db, run, {}, status="failed", error=str(e))
        raise HTTPException(500, str(e))
    finally:
        _is_running = False


@app.post("/api/analyze/mock")
async def analyze_mock(db: Session = Depends(get_db)):
    return await analyze(AnalyzeRequest(use_mock_news=True), db)


@app.get("/api/reports/latest")
def latest_report(db: Session = Depends(get_db)):
    run = crud.get_latest_run(db)
    if not run:
        raise HTTPException(404, "No report yet.")
    reports = crud.get_reports_for_run(db, run.id)
    signals = crud.get_signals_for_run(db, run.id)
    return {
        "run_id": run.id,
        "generated_at": run.run_at.isoformat(),
        "risk_reports": [_r(r) for r in reports],
        "signals": [_sig(s) for s in signals],
        "stats": {"total_shipments": run.shipments_checked, "articles_fetched": run.articles_fetched, "signals_extracted": run.signals_extracted, "affected_shipments": run.affected_shipments, "high_risk": run.high_risk, "medium_risk": run.medium_risk, "low_risk": run.low_risk, "llm_calls_used": run.llm_calls_used, "llm_calls_saved": run.llm_calls_saved},
    }


@app.get("/api/runs")
def get_runs(limit: int = 20, db: Session = Depends(get_db)):
    runs = crud.get_runs(db, limit=limit)
    return {"runs": [{"id": r.id, "run_at": r.run_at.isoformat(), "status": r.status, "llm_provider": r.llm_provider, "used_mock_news": r.used_mock_news, "affected_shipments": r.affected_shipments, "high_risk": r.high_risk, "medium_risk": r.medium_risk, "llm_calls_used": r.llm_calls_used, "llm_calls_saved": r.llm_calls_saved} for r in runs]}


@app.post("/api/upload-csv")
async def upload_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files accepted.")
    contents = await file.read()
    shipments = list(csv.DictReader(io.StringIO(contents.decode("utf-8"))))
    if not shipments:
        raise HTTPException(400, "CSV empty or malformed.")
    crud.delete_all_shipments(db)
    crud.upsert_shipments(db, shipments)
    return {"status": "ok", "count": len(shipments), "preview": shipments[:3]}


# ── Serializers ──────────────────────────────────────────────

def _s(s) -> dict:
    return {k: getattr(s, k, None) for k in ["shipment_id", "vendor", "origin_city", "origin_country", "dest_city", "dest_country", "origin_port", "dest_port", "carrier", "transport_mode", "sku", "sku_category", "route", "departure_date", "eta", "freight_cost_usd"]}


def _r(r) -> dict:
    return {k: getattr(r, k, None) for k in ["shipment_id", "risk_level", "delay_estimate", "primary_risk", "explanation", "suggested_action", "confidence", "matched_signals"]}


def _sig(s) -> dict:
    return {"source_title": s.source_title, "source": s.source_name, "published_at": s.published_at, "risk_type": s.risk_type, "severity": s.severity, "summary": s.summary, "affected_ports": s.affected_ports, "affected_cities": s.affected_cities, "affected_routes": s.affected_routes, "affected_carriers": s.affected_carriers}


def _build_stats(reports, shipments, articles, signals) -> dict:
    high = sum(1 for r in reports if r.get("risk_level") == "HIGH")
    med = sum(1 for r in reports if r.get("risk_level") == "MEDIUM")
    used = len(articles) + len(reports)
    return {"total_shipments": len(shipments), "articles_fetched": len(articles), "signals_extracted": len(signals), "affected_shipments": len(reports), "high_risk": high, "medium_risk": med, "low_risk": len(reports)-high-med, "llm_calls_used": used, "llm_calls_saved": max(0, len(shipments)*len(articles)-used)}


def _empty_stats(shipments, articles) -> dict:
    return {"total_shipments": len(shipments), "articles_fetched": len(articles), "signals_extracted": 0, "affected_shipments": 0, "high_risk": 0, "medium_risk": 0, "low_risk": 0, "llm_calls_used": len(articles), "llm_calls_saved": 0}
