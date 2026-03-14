"""
backend/server.py — FastAPI + PostgreSQL
"""

from contextlib import asynccontextmanager
import io
import csv
import os
import os
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.news_fetcher import fetch_news
from backend.core.risk_analyzer import analyze_risks
from backend.core.route_resolver import build_map_feature
from backend.core.shipment_matcher import match_shipments_to_signals
from backend.core.signal_extractor import extract_signals
from backend.data.shipments import SAMPLE_SHIPMENTS
from backend.db import crud
from backend.db.database import get_db, init_db
from backend.providers.llm import PROVIDER

_is_running = False
_local_latest_report: dict | None = None
LOCAL_SHIPMENTS_FLAG = "USE_LOCAL_SAMPLE_SHIPMENTS"

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
        if not _use_local_sample_shipments() and not crud.get_all_shipments(db):
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
    shipments = _get_shipments(db)
    return {
        "status": "ok",
        "llm_provider": PROVIDER,
        "shipment_count": len(shipments),
        "last_run": latest.run_at.isoformat() if latest else None,
        "using_local_sample_shipments": _use_local_sample_shipments(),
    }


@app.get("/api/shipments")
def get_shipments(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    risk_status: str | None = None,
    db: Session = Depends(get_db),
):
    normalized_status = _normalize_risk_status(risk_status)
    reports_by_shipment = _get_latest_reports_by_shipment(db)

    if _use_local_sample_shipments():
        shipments = _filter_local_shipments(
            [s.copy() for s in SAMPLE_SHIPMENTS],
            q=q,
            risk_status=normalized_status,
            reports_by_shipment=reports_by_shipment,
        )
        total = len(shipments)
        summary = _summarize_shipments(shipments)
        paged = shipments[(page - 1) * page_size: page * page_size]
        return _shipment_page_response(paged, total, page, page_size, summary)

    shipment_ids, exclude_ids = _shipment_filters_from_status(normalized_status, reports_by_shipment)
    shipments, total, summary = crud.get_shipments_page(
        db,
        page=page,
        page_size=page_size,
        search=q,
        shipment_ids=shipment_ids,
        exclude_ids=exclude_ids,
    )
    return _shipment_page_response([_s(s) for s in shipments], total, page, page_size, summary)


@app.get("/api/shipments/map")
def get_shipments_map(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    risk_status: str | None = None,
    db: Session = Depends(get_db),
):
    normalized_status = _normalize_risk_status(risk_status)
    reports_by_shipment = _get_latest_reports_by_shipment(db)

    if _use_local_sample_shipments():
        shipments = _filter_local_shipments(
            [s.copy() for s in SAMPLE_SHIPMENTS],
            q=q,
            risk_status=normalized_status,
            reports_by_shipment=reports_by_shipment,
        )
        total = len(shipments)
        paged = shipments[(page - 1) * page_size: page * page_size]
        features = [
            build_map_feature(db, shipment, reports_by_shipment.get(shipment.get("shipment_id")))
            for shipment in paged
        ]
        return _map_page_response(features, total, page, page_size)

    shipment_ids, exclude_ids = _shipment_filters_from_status(normalized_status, reports_by_shipment)
    shipments, total, _ = crud.get_shipments_page(
        db,
        page=page,
        page_size=page_size,
        search=q,
        shipment_ids=shipment_ids,
        exclude_ids=exclude_ids,
    )
    features = [
        build_map_feature(db, _s(shipment), reports_by_shipment.get(shipment.shipment_id))
        for shipment in shipments
    ]
    return _map_page_response(features, total, page, page_size)


@app.get("/api/shipments/{shipment_id}")
def get_shipment(shipment_id: str, db: Session = Depends(get_db)):
    s = _get_shipment(db, shipment_id)
    if not s:
        raise HTTPException(404, f"Shipment {shipment_id} not found")
    if _use_local_sample_shipments():
        history = []
        if _local_latest_report:
            matching = [
                report for report in _local_latest_report.get("risk_reports", [])
                if report.get("shipment_id") == shipment_id
            ]
            history = matching
        return {"shipment": s, "risk_history": history}

    history = crud.get_risk_history_for_shipment(db, shipment_id)
    return {"shipment": s, "risk_history": [_r(r) for r in history]}


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest, db: Session = Depends(get_db)):
    global _is_running
    global _local_latest_report
    if _is_running:
        raise HTTPException(409, "Analysis already running.")
    _is_running = True
    run = crud.create_run(db, llm_provider=PROVIDER, used_mock_news=req.use_mock_news)

    def _do_analyze():
        global _local_latest_report
        shipments = _get_shipments(db)
        articles = MOCK_NEWS if req.use_mock_news else fetch_news(req.max_articles, shipments=shipments)
        signals = extract_signals(articles)

        if not signals:
            crud.complete_run(db, run, _empty_stats(shipments, articles), status="no_signals")
            payload = {"status": "no_signals", "run_id": run.id, "generated_at": run.run_at.isoformat(), "risk_reports": [], "signals": [], "stats": _empty_stats(shipments, articles)}
            if _use_local_sample_shipments():
                _local_latest_report = payload
            return payload

        crud.save_signals(db, run.id, signals)
        affected = match_shipments_to_signals([s.copy() for s in shipments], signals)

        if not affected:
            stats = {**_empty_stats(shipments, articles), "signals_extracted": len(signals)}
            crud.complete_run(db, run, stats, status="no_affected")
            payload = {"status": "no_affected", "run_id": run.id, "generated_at": run.run_at.isoformat(), "risk_reports": [], "signals": signals, "stats": stats}
            if _use_local_sample_shipments():
                _local_latest_report = payload
            return payload

        risk_reports = analyze_risks(affected)
        if not _use_local_sample_shipments():
            crud.save_risk_reports(db, run.id, risk_reports)
        stats = _build_stats(risk_reports, shipments, articles, signals)
        crud.complete_run(db, run, stats)
        payload = {"status": "success", "run_id": run.id, "generated_at": run.run_at.isoformat(), "risk_reports": risk_reports, "signals": signals, "stats": stats}
        if _use_local_sample_shipments():
            _local_latest_report = payload

        return payload

    try:
        payload = await run_in_threadpool(_do_analyze)
        return payload

    except Exception as e:
        if _use_local_sample_shipments():
            _local_latest_report = None
        crud.complete_run(db, run, {}, status="failed", error=str(e))
        raise HTTPException(500, str(e))
    finally:
        _is_running = False


@app.post("/api/analyze/mock")
async def analyze_mock(db: Session = Depends(get_db)):
    return await analyze(AnalyzeRequest(**{"use_mock_news": True}), db)


@app.get("/api/reports/latest")
def latest_report(db: Session = Depends(get_db)):
    if _use_local_sample_shipments():
        if not _local_latest_report:
            raise HTTPException(404, "No report yet.")
        return _local_latest_report

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
    shipments_reader = csv.DictReader(io.StringIO(contents.decode("utf-8")))
    shipments = []
    for row in shipments_reader:
        cleaned_row = {k: (v if v != "" else None) for k, v in row.items()}
        shipments.append(cleaned_row)
    if not shipments:
        raise HTTPException(400, "CSV empty or malformed.")
    crud.delete_all_shipments(db)
    crud.upsert_shipments(db, shipments)
    return {"status": "ok", "count": len(shipments), "preview": shipments[:3]}


@app.delete("/api/clear")
async def clear_database(db: Session = Depends(get_db)):
    """Deletes all data from the database."""
    global _local_latest_report
    crud.delete_all_data(db)
    _local_latest_report = None
    return {"status": "ok", "message": "Database cleared."}


# ── Serializers ──────────────────────────────────────────────

def _s(s) -> dict:
    return {k: getattr(s, k, None) for k in ["shipment_id", "vendor", "origin_city", "origin_country", "dest_city", "dest_country", "origin_port", "dest_port", "carrier", "transport_mode", "sku", "sku_category", "route", "departure_date", "eta", "freight_cost_usd"]}


def _use_local_sample_shipments() -> bool:
    return os.getenv(LOCAL_SHIPMENTS_FLAG, "").strip().lower() in {"1", "true", "yes", "on"}


def _get_shipments(db: Session) -> list[dict]:
    if _use_local_sample_shipments():
        return [s.copy() for s in SAMPLE_SHIPMENTS]
    return [_s(s) for s in crud.get_all_shipments(db)]


def _get_shipment(db: Session, shipment_id: str) -> dict | None:
    if _use_local_sample_shipments():
        for shipment in SAMPLE_SHIPMENTS:
            if shipment.get("shipment_id") == shipment_id:
                return shipment.copy()
        return None
    shipment = crud.get_shipment(db, shipment_id)
    return _s(shipment) if shipment else None


def _normalize_risk_status(risk_status: str | None) -> str | None:
    if not risk_status:
        return None
    normalized = risk_status.strip().upper()
    if normalized not in {"HIGH", "MEDIUM", "LOW", "PENDING"}:
        raise HTTPException(400, "Invalid risk_status. Use HIGH, MEDIUM, LOW, or PENDING.")
    return normalized


def _get_latest_reports_by_shipment(db: Session) -> dict[str, dict]:
    if _use_local_sample_shipments():
        if not _local_latest_report:
            return {}
        return {report["shipment_id"]: report for report in _local_latest_report.get("risk_reports", [])}
    reports = crud.get_latest_reports(db)
    return {r.shipment_id: _r(r) for r in reports}


def _matches_search(shipment: dict, query: str | None) -> bool:
    term = (query or "").strip().lower()
    if not term:
        return True
    haystacks = [
        shipment.get("shipment_id"),
        shipment.get("vendor"),
        shipment.get("origin_city"),
        shipment.get("dest_city"),
        shipment.get("origin_port"),
        shipment.get("dest_port"),
        shipment.get("carrier"),
    ]
    return any(term in str(value or "").lower() for value in haystacks)


def _matches_risk_status(shipment: dict, risk_status: str | None, reports_by_shipment: dict[str, dict]) -> bool:
    if not risk_status:
        return True
    report = reports_by_shipment.get(shipment.get("shipment_id"))
    if risk_status == "PENDING":
        return report is None
    return bool(report and report.get("risk_level") == risk_status)


def _filter_local_shipments(
    shipments: list[dict],
    *,
    q: str | None,
    risk_status: str | None,
    reports_by_shipment: dict[str, dict],
) -> list[dict]:
    filtered = []
    for shipment in shipments:
        if not _matches_search(shipment, q):
            continue
        if not _matches_risk_status(shipment, risk_status, reports_by_shipment):
            continue
        filtered.append(shipment)
    filtered.sort(key=lambda shipment: shipment.get("shipment_id") or "")
    return filtered


def _summarize_shipments(shipments: list[dict]) -> dict:
    return {
        "total": len(shipments),
        "sea": sum(1 for shipment in shipments if shipment.get("transport_mode") == "Sea"),
        "air": sum(1 for shipment in shipments if shipment.get("transport_mode") == "Air"),
    }


def _shipment_filters_from_status(risk_status: str | None, reports_by_shipment: dict[str, dict]) -> tuple[list[str] | None, list[str] | None]:
    if not risk_status:
        return None, None
    report_ids = list(reports_by_shipment.keys())
    if risk_status == "PENDING":
        return None, report_ids
    matching = [shipment_id for shipment_id, report in reports_by_shipment.items() if report.get("risk_level") == risk_status]
    return matching, None


def _shipment_page_response(shipments: list[dict], total: int, page: int, page_size: int, summary: dict) -> dict:
    total_pages = (total + page_size - 1) // page_size if total else 0
    return {
        "shipments": shipments,
        "count": len(shipments),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "summary": summary,
    }


def _map_page_response(shipments: list[dict], total: int, page: int, page_size: int) -> dict:
    total_pages = (total + page_size - 1) // page_size if total else 0
    return {
        "shipments": shipments,
        "count": len(shipments),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def _r(r) -> dict:
    return {k: getattr(r, k, None) for k in ["shipment_id", "risk_level", "delay_estimate", "primary_risk", "explanation", "suggested_action", "confidence", "matched_signals", "created_at"]}


def _sig(s) -> dict:
    return {"source_title": s.source_title, "source": s.source_name, "published_at": s.published_at, "risk_type": s.risk_type, "severity": s.severity, "summary": s.summary, "affected_ports": s.affected_ports, "affected_cities": s.affected_cities, "affected_routes": s.affected_routes, "affected_carriers": s.affected_carriers}


def _build_stats(reports, shipments, articles, signals) -> dict:
    high = sum(1 for r in reports if r.get("risk_level") == "HIGH")
    med = sum(1 for r in reports if r.get("risk_level") == "MEDIUM")
    used = len(articles) + len(reports)
    return {"total_shipments": len(shipments), "articles_fetched": len(articles), "signals_extracted": len(signals), "affected_shipments": len(reports), "high_risk": high, "medium_risk": med, "low_risk": len(reports)-high-med, "llm_calls_used": used, "llm_calls_saved": max(0, len(shipments)*len(articles)-used)}


def _empty_stats(shipments, articles) -> dict:
    return {"total_shipments": len(shipments), "articles_fetched": len(articles), "signals_extracted": 0, "affected_shipments": 0, "high_risk": 0, "medium_risk": 0, "low_risk": 0, "llm_calls_used": len(articles), "llm_calls_saved": 0}
