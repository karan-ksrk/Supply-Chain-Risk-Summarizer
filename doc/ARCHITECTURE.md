# Architecture - Supply Chain Risk Summarizer

## 1) High-Level Design

```text
Frontend (Next.js)
   |
   v
FastAPI Backend
   |
   +--> News Fetcher (NewsAPI -> RSS fallback)
   +--> Signal Extractor (LLM, batched)
   +--> Shipment Matcher (deterministic Python)
   +--> Risk Analyzer (LLM, batched, affected only)
   +--> Route Resolver (geocode + searoute/fallback + cache)
   |
   v
PostgreSQL (shipments, runs, signals, reports, route_cache)
```

## 2) Pipeline Stages

### Stage A: News Acquisition

- module: `backend/core/news_fetcher.py`
- priority:
1. NewsAPI (if valid `NEWS_API_KEY`)
2. Google News RSS fallback

Articles are deduplicated and ranked by:

- disruption keywords
- shipment entity overlap (ports, carriers, routes, countries, cities)
- trusted source boost
- recency boost

### Stage B: Signal Extraction (LLM)

- module: `backend/core/signal_extractor.py`
- output: structured JSON signal per relevant article
- supports batched extraction (`signal_batch_size`)
- fallback to single-item extraction if batch output is malformed

### Stage C: Shipment Matching (Deterministic)

- module: `backend/core/shipment_matcher.py`
- pure Python, no LLM
- case-insensitive substring matching between shipment terms and signal terms
- only matched shipments continue to final analysis

### Stage D: Risk Analysis (LLM)

- module: `backend/core/risk_analyzer.py`
- batched risk analysis (`risk_batch_size`)
- fallback to single-item calls on batch failure
- normalizes risk and confidence fields to `HIGH|MEDIUM|LOW`

### Stage E: Persistence + Stats

- run metadata and stats saved into `analysis_runs`
- extracted signals saved into `news_signals`
- per-shipment reports saved into `risk_reports`

## 3) API Execution Model

### Main analysis paths

- `POST /api/analyze` - synchronous response after pipeline completion
- `POST /api/analyze/stream` - SSE events during run, final completion event with full result
- `POST /api/analyze/mock` - analysis with built-in mock news

### Concurrency guard

- backend uses a process-local `_is_running` flag
- parallel run attempts return `HTTP 409`

## 4) Data Model

### `shipments`

Master shipment dataset (from seed or CSV upload).

### `analysis_runs`

One row per execution, status and KPIs:

- `articles_fetched`
- `signals_extracted`
- `shipments_checked`
- `affected_shipments`
- `high_risk`, `medium_risk`, `low_risk`
- `llm_calls_used`, `llm_calls_saved`
- `status`, `error_message`

### `news_signals`

Extracted disruption signals tied to a run.

### `risk_reports`

Shipment-level risk outputs tied to a run.

### `route_cache`

Caches resolved coordinates and route geometry to avoid recomputation.

## 5) Map/Route Design

- module: `backend/core/route_resolver.py`
- geocoding via Nominatim (with known-location overrides)
- sea routes try `searoute` library geometry
- fallback route uses straight-line coordinates + haversine distance
- route output is normalized for Leaflet rendering

## 6) Local Sample Mode

Environment flag: `USE_LOCAL_SAMPLE_SHIPMENTS`

When enabled:

- shipments are served from in-memory sample data
- latest report may be stored in `_local_latest_report`
- useful for demo/testing without DB-backed shipment persistence

## 7) LLM Provider Abstraction

- module: `backend/providers/llm.py`
- provider selected by `LLM_PROVIDER`
- supported: `claude`, `openai`, `ollama`, `bedrock`
- all callers use:
  - `call_llm(...)`
  - `parse_json_response(...)`

This keeps pipeline logic provider-agnostic.

## 8) Frontend Architecture

### Pages

- `/` Dashboard (run analysis, stream status, map, risks, signals)
- `/shipments` Paginated shipment table + CSV upload
- `/shipments/[id]` Shipment detail + risk history
- `/reports` Latest report, charts, report cards, signals
- `/runs` Historical run log

### Data access

- typed API client in `frontend/lib/api.ts`
- uses fetch + typed interfaces for backend responses

### Real-time UX

- dashboard consumes SSE from `/api/analyze/stream`
- updates pipeline stage and partial outputs incrementally

## 9) Efficiency Model

LLM calls are tracked as:

- `signal_calls = ceil(articles / signal_batch_size)`
- `risk_calls = ceil(affected_shipments / risk_batch_size)`
- `llm_calls_used = signal_calls + risk_calls`
- `llm_calls_saved = max(0, shipments * articles - llm_calls_used)`

This gives a concrete measure of optimization impact per run.
