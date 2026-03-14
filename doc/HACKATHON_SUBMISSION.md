# Hackathon Submission - Supply Chain Risk Summarizer

## 1) Project Title

**Supply Chain Risk Summarizer (Nexus Risk Dashboard)**

## 2) Problem Statement

Global logistics teams monitor thousands of shipments while disruptions (strikes, weather, geopolitical events, congestion, customs delays) evolve hourly.  
Current workflows are often manual and reactive:

- teams read news manually
- impact mapping to specific shipments is slow
- risk communication is inconsistent
- AI costs can become high if every shipment is analyzed against every article

## 3) Our Solution

We built an AI-powered risk intelligence system that:

1. fetches latest logistics-relevant news
2. converts each article into structured disruption signals using an LLM
3. deterministically matches signals to affected shipments (no LLM cost in this step)
4. runs LLM risk assessment only for affected shipments
5. stores full run history, signals, and reports in PostgreSQL
6. visualizes risk, map routes, and operational actions in a web dashboard

## 4) Core Innovation

The key innovation is a **cost-efficient two-stage AI pipeline**:

- Stage A: `articles -> structured signals` (batched LLM)
- Stage B: `signals x shipments -> deterministic matching` (pure Python)
- Stage C: `only affected shipments -> risk report` (batched LLM)

This avoids naive `shipments x articles` LLM calls.

The platform tracks:

- `llm_calls_used`
- `llm_calls_saved`

for each run, making efficiency measurable and transparent.

## 5) Why This Matters

- Faster disruption response for logistics teams
- Explainable risk decisions tied to source signals
- Lower AI cost through targeted inference
- Better operational visibility through map + run history + shipment drill-down

## 6) Key Features Delivered

- Live or mock-news analysis runs
- Server-Sent Events (SSE) streaming for real-time pipeline progress
- Risk levels: `HIGH`, `MEDIUM`, `LOW`, `PENDING`
- Shipment map with route rendering and cached route resolution
- CSV upload to replace shipment master data
- Run history and audit trail of pipeline execution
- Multi-provider LLM support: Claude, OpenAI, Ollama, AWS Bedrock

## 7) End-to-End Workflow

1. User starts analysis from dashboard.
2. Backend creates `analysis_runs` record with `running` status.
3. News is fetched from NewsAPI or Google News RSS fallback.
4. Batched LLM extracts structured signals from articles.
5. Signals are stored in `news_signals`.
6. Pure Python matcher links signals to affected shipments.
7. Batched LLM generates risk reports only for affected shipments.
8. Reports are stored in `risk_reports`.
9. Run is finalized with KPI stats and status.
10. Frontend updates dashboard, reports, runs, and map views.

## 8) Tech Stack

### Backend

- FastAPI
- SQLAlchemy
- PostgreSQL
- Python pipeline modules for fetching, extraction, matching, analysis

### Frontend

- Next.js 14 + React 18 + TypeScript
- Tailwind CSS
- Recharts (risk distribution)
- Leaflet + React-Leaflet (route map)

### AI / Providers

- Anthropic Claude
- OpenAI
- Ollama (local model)
- AWS Bedrock

## 9) Database Design

Core tables:

- `shipments`
- `analysis_runs`
- `news_signals`
- `risk_reports`
- `route_cache`

This schema supports both real-time operations and historical analysis.

## 10) Operational KPIs Exposed

Each run reports:

- total shipments checked
- articles fetched
- signals extracted
- affected shipments
- high/medium/low counts
- LLM calls used
- LLM calls saved

## 11) Demo Reliability for Judges

The app supports `mock-news` mode to guarantee a deterministic demo even without external news/API availability.

- `POST /api/analyze/mock` (or "Mock News" button in UI)

This ensures the judging session remains stable and reproducible.

## 12) Security / Robustness Notes

- Single-run lock prevents overlapping analysis in one backend process (`409` if a run is active)
- Run status tracking includes `success`, `failed`, `no_signals`, `no_affected`, `running`
- Error messages are persisted in run logs
- CSV file type validation is enforced

## 13) Current Limitations

- In-process `_is_running` lock is not a distributed lock (single instance scope)
- News quality depends on external feeds
- Matching logic is substring-based and may miss semantic relationships
- `POST /api/upload-csv` replaces all shipments (no merge strategy yet)

## 14) Roadmap

1. Semantic/entity-linking matcher to reduce false positives/negatives
2. Multi-instance distributed run locking
3. Alerting integrations (Slack/Email/Teams)
4. Role-based access and organization-level workspaces
5. Predictive delay modeling with historical shipment outcomes

## 15) Judge-Focused 2-Minute Pitch

We built an AI-first logistics control tower that turns live disruption news into shipment-level action.  
The differentiator is our two-stage architecture: we first extract structured risk signals once per article, then match shipments with deterministic logic, and only send truly affected shipments for deeper LLM analysis.  
That reduces cost, increases speed, and keeps reasoning explainable.  
Judges can see this directly through run KPIs like `llm_calls_saved`, detailed risk reports, source-linked signals, and global route visualization.  
The product is demo-safe with mock news mode and production-ready foundations with PostgreSQL persistence, audit history, and multi-LLM provider support.

## 16) Repository Pointers

- Backend API entry: `backend/server.py`
- Pipeline modules: `backend/core/`
- DB models/crud: `backend/db/`
- Frontend app: `frontend/app/`
- API client: `frontend/lib/api.ts`
