"""
backend/db/models.py
--------------------
4 tables:
  - shipments       : master shipment data (loaded from CSV or defaults)
  - news_signals    : extracted LLM signals from news articles
  - risk_reports    : per-shipment risk analysis results
  - analysis_runs   : log of every pipeline run (metadata + stats)
"""

from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Float, Boolean,
    DateTime, Text, JSON, ForeignKey
)
from sqlalchemy.orm import relationship
from backend.db.database import Base


class Shipment(Base):
    __tablename__ = "shipments"

    shipment_id = Column(String, primary_key=True, index=True)
    vendor = Column(String, nullable=False)
    origin_city = Column(String)
    origin_country = Column(String)
    dest_city = Column(String)
    dest_country = Column(String)
    origin_port = Column(String)
    dest_port = Column(String)
    carrier = Column(String)
    transport_mode = Column(String)
    sku = Column(String)
    sku_category = Column(String)
    route = Column(String)
    departure_date = Column(String)
    eta = Column(String)
    freight_cost_usd = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    risk_reports = relationship("RiskReport", back_populates="shipment", cascade="all, delete-orphan")


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_at = Column(DateTime, default=datetime.utcnow, index=True)
    llm_provider = Column(String)
    used_mock_news = Column(Boolean, default=False)
    articles_fetched = Column(Integer, default=0)
    signals_extracted = Column(Integer, default=0)
    shipments_checked = Column(Integer, default=0)
    affected_shipments = Column(Integer, default=0)
    high_risk = Column(Integer, default=0)
    medium_risk = Column(Integer, default=0)
    low_risk = Column(Integer, default=0)
    llm_calls_used = Column(Integer, default=0)
    llm_calls_saved = Column(Integer, default=0)
    status = Column(String, default="success")  # success | failed | no_signals
    error_message = Column(Text, nullable=True)

    # Relationships
    news_signals = relationship("NewsSignal", back_populates="run", cascade="all, delete-orphan")
    risk_reports = relationship("RiskReport", back_populates="run", cascade="all, delete-orphan")


class NewsSignal(Base):
    __tablename__ = "news_signals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("analysis_runs.id"), nullable=False, index=True)
    source_title = Column(Text)
    source_url = Column(Text)
    source_name = Column(String)
    published_at = Column(String)
    risk_type = Column(String)   # PORT_STRIKE | WEATHER | GEOPOLITICAL | etc.
    severity = Column(String)   # HIGH | MEDIUM | LOW
    summary = Column(Text)
    affected_ports = Column(JSON, default=list)
    affected_cities = Column(JSON, default=list)
    affected_countries = Column(JSON, default=list)
    affected_routes = Column(JSON, default=list)
    affected_carriers = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)

    run = relationship("AnalysisRun", back_populates="news_signals")


class RiskReport(Base):
    __tablename__ = "risk_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("analysis_runs.id"), nullable=False, index=True)
    shipment_id = Column(String, ForeignKey("shipments.shipment_id"), nullable=False, index=True)
    risk_level = Column(String)        # HIGH | MEDIUM | LOW
    delay_estimate = Column(String)
    primary_risk = Column(Text)
    explanation = Column(Text)
    suggested_action = Column(Text)
    confidence = Column(String)
    matched_signals = Column(JSON, default=list)   # snapshot of signals that triggered this
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    shipment = relationship("Shipment", back_populates="risk_reports")
    run = relationship("AnalysisRun", back_populates="risk_reports")


class RouteCache(Base):
    __tablename__ = "route_cache"

    route_key = Column(String, primary_key=True, index=True)
    transport_mode = Column(String, nullable=False)
    origin_query = Column(String, nullable=False)
    dest_query = Column(String, nullable=False)
    origin_lat = Column(Float, nullable=True)
    origin_lng = Column(Float, nullable=True)
    dest_lat = Column(Float, nullable=True)
    dest_lng = Column(Float, nullable=True)
    route_kind = Column(String, nullable=False, default="fallback")
    route_source = Column(String, nullable=False, default="fallback")
    distance_nm = Column(Float, nullable=True)
    raw_geojson = Column(JSON, nullable=True)
    normalized_coordinates = Column(JSON, default=list)
    route_metadata = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
