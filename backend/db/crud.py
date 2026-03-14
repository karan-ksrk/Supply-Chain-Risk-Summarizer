from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_

from backend.db.models import Shipment, AnalysisRun, NewsSignal, RiskReport, RouteCache


# ── Shipments ────────────────────────────────────────────────

def upsert_shipments(db: Session, shipments: list[dict]) -> int:
    """Insert or update shipments. Returns count saved."""
    for s in shipments:
        existing = db.query(Shipment).filter(Shipment.shipment_id == s.get("shipment_id")).first()
        if existing:
            for key, val in s.items():
                if hasattr(existing, key):
                    setattr(existing, key, val)
            existing.updated_at = datetime.utcnow()
        else:
            db.add(Shipment(**{k: v for k, v in s.items() if hasattr(Shipment, k)}))
    db.commit()
    return len(shipments)


def _apply_shipment_search(query, search: str | None):
    term = (search or "").strip()
    if not term:
        return query
    like = f"%{term}%"
    return query.filter(or_(
        Shipment.shipment_id.ilike(like),
        Shipment.vendor.ilike(like),
        Shipment.origin_city.ilike(like),
        Shipment.dest_city.ilike(like),
        Shipment.origin_port.ilike(like),
        Shipment.dest_port.ilike(like),
        Shipment.carrier.ilike(like),
    ))


def get_all_shipments(db: Session) -> list[Shipment]:
    return db.query(Shipment).order_by(Shipment.shipment_id).all()


def get_shipments_page(
    db: Session,
    *,
    page: int,
    page_size: int,
    search: str | None = None,
    shipment_ids: list[str] | None = None,
    exclude_ids: list[str] | None = None,
) -> tuple[list[Shipment], int, dict]:
    query = _apply_shipment_search(db.query(Shipment), search)

    if shipment_ids is not None:
        if not shipment_ids:
            return [], 0, {"total": 0, "sea": 0, "air": 0}
        query = query.filter(Shipment.shipment_id.in_(shipment_ids))

    if exclude_ids:
        query = query.filter(~Shipment.shipment_id.in_(exclude_ids))

    total = query.count()
    summary = {
        "total": total,
        "sea": query.filter(Shipment.transport_mode == "Sea").count(),
        "air": query.filter(Shipment.transport_mode == "Air").count(),
    }
    items = (
        query.order_by(Shipment.shipment_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total, summary


def get_shipment(db: Session, shipment_id: str) -> Shipment | None:
    return db.query(Shipment).filter(Shipment.shipment_id == shipment_id).first()


def delete_all_shipments(db: Session):
    db.query(Shipment).delete()
    db.commit()


def delete_all_data(db: Session):
    # Child tables must be deleted before their parent tables
    # due to foreign key constraints in SQLite / SQLAlchemy
    db.query(RiskReport).delete()
    db.query(NewsSignal).delete()
    db.query(AnalysisRun).delete()
    db.query(Shipment).delete()
    db.query(RouteCache).delete()
    db.commit()


# ── Analysis Runs ────────────────────────────────────────────

def create_run(db: Session, llm_provider: str, used_mock_news: bool) -> AnalysisRun:
    """Create a new analysis run record. Returns the run (with ID)."""
    run = AnalysisRun(
        llm_provider=llm_provider,
        used_mock_news=used_mock_news,
        status="running",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def complete_run(db: Session, run: AnalysisRun, stats: dict, status: str = "success", error: str = None):
    """Update run with final stats after pipeline completes."""
    run.articles_fetched = stats.get("articles_fetched", 0)
    run.signals_extracted = stats.get("signals_extracted", 0)
    run.shipments_checked = stats.get("total_shipments", 0)
    run.affected_shipments = stats.get("affected_shipments", 0)
    run.high_risk = stats.get("high_risk", 0)
    run.medium_risk = stats.get("medium_risk", 0)
    run.low_risk = stats.get("low_risk", 0)
    run.llm_calls_used = stats.get("llm_calls_used", 0)
    run.llm_calls_saved = stats.get("llm_calls_saved", 0)
    run.status = status
    run.error_message = error
    db.commit()
    db.refresh(run)
    return run


def get_runs(db: Session, limit: int = 20) -> list[AnalysisRun]:
    return db.query(AnalysisRun).order_by(desc(AnalysisRun.run_at)).limit(limit).all()


def get_latest_run(db: Session) -> AnalysisRun | None:
    return db.query(AnalysisRun).filter(
        AnalysisRun.status == "success"
    ).order_by(desc(AnalysisRun.run_at)).first()


# ── News Signals ─────────────────────────────────────────────

def save_signals(db: Session, run_id: int, signals: list[dict]) -> int:
    """Save extracted news signals for a run."""
    for sig in signals:
        db.add(NewsSignal(
            run_id=run_id,
            source_title=sig.get("source_title", ""),
            source_url=sig.get("source_url", ""),
            source_name=sig.get("source", ""),
            published_at=sig.get("published_at", ""),
            risk_type=sig.get("risk_type", "OTHER"),
            severity=sig.get("severity", "LOW"),
            summary=sig.get("summary", ""),
            affected_ports=sig.get("affected_ports", []),
            affected_cities=sig.get("affected_cities", []),
            affected_countries=sig.get("affected_countries", []),
            affected_routes=sig.get("affected_routes", []),
            affected_carriers=sig.get("affected_carriers", []),
        ))
    db.commit()
    return len(signals)


def get_signals_for_run(db: Session, run_id: int) -> list[NewsSignal]:
    return db.query(NewsSignal).filter(NewsSignal.run_id == run_id).all()


# ── Risk Reports ─────────────────────────────────────────────

def save_risk_reports(db: Session, run_id: int, reports: list[dict]) -> int:
    """Save LLM risk analysis results for a run."""
    for r in reports:
        db.add(RiskReport(
            run_id=run_id,
            shipment_id=r.get("shipment_id"),
            risk_level=r.get("risk_level", "LOW"),
            delay_estimate=r.get("delay_estimate"),
            primary_risk=r.get("primary_risk", ""),
            explanation=r.get("explanation", ""),
            suggested_action=r.get("suggested_action", ""),
            confidence=r.get("confidence", "LOW"),
            matched_signals=r.get("matched_signals", []),
        ))
    db.commit()
    return len(reports)


def get_reports_for_run(db: Session, run_id: int) -> list[RiskReport]:
    return db.query(RiskReport).filter(RiskReport.run_id == run_id).all()


def get_latest_reports(db: Session) -> list[RiskReport]:
    """Get risk reports from the most recent successful run."""
    latest = get_latest_run(db)
    if not latest:
        return []
    return get_reports_for_run(db, latest.id)


def get_risk_history_for_shipment(db: Session, shipment_id: str, limit: int = 10) -> list[RiskReport]:
    """Get historical risk reports for a specific shipment."""
    return (
        db.query(RiskReport)
        .filter(RiskReport.shipment_id == shipment_id)
        .order_by(desc(RiskReport.created_at))
        .limit(limit)
        .all()
    )


# ── Route cache ──────────────────────────────────────────────

def get_route_cache(db: Session, route_key: str) -> RouteCache | None:
    return db.query(RouteCache).filter(RouteCache.route_key == route_key).first()


def upsert_route_cache(db: Session, payload: dict, *, commit: bool = True) -> RouteCache:
    cache = get_route_cache(db, payload["route_key"])
    if cache:
        for key, val in payload.items():
            if hasattr(cache, key):
                setattr(cache, key, val)
        cache.updated_at = datetime.utcnow()
    else:
        cache = RouteCache(**payload)
        db.add(cache)
    if commit:
        db.commit()
        db.refresh(cache)
    else:
        db.flush()
    return cache
