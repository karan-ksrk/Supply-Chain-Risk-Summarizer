# Supply Chain Risk Summarizer Documentation

## Overview

This application monitors shipment risk by combining logistics news, structured LLM extraction, deterministic shipment matching, and per-shipment AI risk analysis.

At a high level, the app does this:

1. Load shipments from either sample data, uploaded CSV data, or the database.
2. Fetch logistics-related news from NewsAPI or Google News RSS.
3. Use an LLM to convert each article into a structured risk signal.
4. Match those signals to shipments using Python string matching.
5. Send only affected shipments back to the LLM for a final risk assessment.
6. Store run history, extracted signals, and risk reports in PostgreSQL.
7. Show the results in the Next.js frontend.

The main optimization in the design is that the LLM is not called for every shipment/article pair. The app first extracts signals per article, then filters shipments in Python, and only analyzes shipments that were actually matched.

## Repository Structure

```text
backend/
  core/
    news_fetcher.py
    signal_extractor.py
    shipment_matcher.py
    risk_analyzer.py
  data/shipments.py
  db/
    database.py
    models.py
    crud.py
  providers/llm.py
  server.py
  main.py

frontend/
  app/
    page.tsx
    shipments/page.tsx
    shipments/[id]/page.tsx
    reports/page.tsx
    runs/page.tsx
    layout.tsx
  lib/api.ts
  components/ui/index.tsx
```

## How The System Works

### 1. Shipment source

The backend can operate in two modes:

- Database-backed mode:
  The FastAPI server starts PostgreSQL tables and seeds `SAMPLE_SHIPMENTS` into the `shipments` table if the table is empty.
- Local sample mode:
  If `USE_LOCAL_SAMPLE_SHIPMENTS` is set, the API serves shipment data directly from `backend/data/shipments.py` instead of the database.

Important behavior:

- In local sample mode, shipment history is not read from the database.
- In local sample mode, generated risk reports are also not saved to `risk_reports`.
- Analysis runs are still created, so run metadata can still exist even if shipment-level persistence is skipped.

### 2. News fetching

News collection happens in `backend/core/news_fetcher.py`.

The fetch order is:

1. Use NewsAPI if `NEWS_API_KEY` is configured with a non-placeholder value.
2. Fall back to Google News RSS if NewsAPI is unavailable.

The fetcher builds queries in two ways:

- Static disruption queries such as `port strike`, `cargo delay`, `Red Sea shipping`, and `dock workers strike`
- Dynamic queries derived from shipment data, including ports, carriers, routes, countries, and cities

This lets the news search focus on disruptions that are more likely to affect the current shipment set.

After collection, the fetcher:

- deduplicates articles
- ranks them
- returns a trimmed list of the most relevant articles

The ranking logic is implemented in `_rank_articles(...)` and `_score_article(...)`.
Each article gets a `relevance_score`, and the backend sorts by:

1. higher relevance score first
2. newer publication timestamp first when scores are tied

The score is built from four signals:

- Disruption keywords
  Terms such as `strike`, `congestion`, `delay`, `closure`, `reroute`, `attack`, `sanctions`, `customs`, `typhoon`, and `cyclone` add weight.
  A keyword found in the title gets a slightly larger boost than the same keyword in the description.
- Shipment entity matches
  If shipment data is available, the fetcher first extracts the most common ports, carriers, routes, countries, and cities from the current shipment set.
  Articles mentioning those same entities get additional score.
  As with keywords, matches in the title score higher than matches only found in the combined title and description.
- Trusted source boost
  Known logistics publications such as FreightWaves, Lloyd's List, Journal of Commerce, JOC, Air Cargo News, and The Loadstar receive an extra score bonus.
- Recency boost
  Very recent stories receive more points than older ones.
  The boost is tiered:
  within 24 hours = 4 points, within 72 hours = 3 points, within 7 days = 2 points, older = 1 point.

Entity types do not all carry the same importance. The exact base weights are:

- ports: `8`
- carriers: `7`
- routes: `6`
- countries: `4`
- cities: `3`

Entity matches also get a position bonus:

- if the entity appears in the title: `base weight + 2`
- if the entity appears only in the combined title/description text: `base weight`

So the exact entity scoring outcomes are:

- port in title: `10`
- port in description/body only: `8`
- carrier in title: `9`
- carrier in description/body only: `7`
- route in title: `8`
- route in description/body only: `6`
- country in title: `6`
- country in description/body only: `4`
- city in title: `5`
- city in description/body only: `3`

Before ranking, the fetcher also removes duplicates using a normalized combination of:

- article URL
- article title

This ranking strategy is intentionally heuristic rather than model-based. It prioritizes stories that both look like real disruptions and overlap with the shipment network currently loaded into the app.

Each article is normalized into:

```json
{
  "title": "Article title",
  "description": "Short article description",
  "source": "Publisher name",
  "published_at": "Timestamp",
  "url": "Source URL"
}
```

### 3. Signal extraction

Signal extraction happens in `backend/core/signal_extractor.py`.

For each article, the backend makes one LLM call and asks for structured JSON with:

- logistics relevance
- risk type
- severity
- affected ports
- affected cities
- affected countries
- affected routes
- affected carriers
- one-line summary

Non-logistics articles are discarded immediately.

Relevant articles become structured signals like:

```json
{
  "risk_type": "PORT_STRIKE",
  "severity": "HIGH",
  "affected_ports": ["Port of LA"],
  "affected_routes": ["Trans-Pacific"],
  "affected_carriers": [],
  "summary": "Dock slowdown is expected to delay container throughput."
}
```

The original article metadata is then attached to the signal so the frontend can display where it came from.

### 4. Shipment matching

Shipment matching happens in `backend/core/shipment_matcher.py`.

This step uses pure Python only. No LLM calls are made here.

For each shipment, the matcher compares shipment fields like:

- origin city and country
- destination city and country
- origin and destination port
- carrier
- route
- transport mode

against signal fields like:

- affected ports
- affected cities
- affected countries
- affected routes
- affected carriers

The matching logic is case-insensitive substring matching in both directions. If any term overlaps, that signal is attached to that shipment.

Only shipments with at least one matched signal move to the final AI analysis stage.

### 5. Risk analysis

Risk analysis happens in `backend/core/risk_analyzer.py`.

For each affected shipment, the backend makes one LLM call with:

- the shipment payload
- the matched news signals

The model returns structured JSON with:

- `risk_level`
- `delay_estimate`
- `primary_risk`
- `explanation`
- `suggested_action`
- `confidence`

The backend then enriches the response with shipment context such as vendor, route, ETA, carrier, and the matched signals used to justify the result.

### 6. Persistence

Database setup is handled in `backend/db/database.py` and data access in `backend/db/crud.py`.

The system uses four tables:

- `shipments`
  Stores the current shipment master data.
- `analysis_runs`
  Stores one row per pipeline execution, including provider, status, and stats.
- `news_signals`
  Stores extracted article signals for a run.
- `risk_reports`
  Stores per-shipment AI assessments for a run.

The `analysis_runs` table also stores efficiency metrics such as:

- articles fetched
- signals extracted
- shipments checked
- affected shipments
- high, medium, and low counts
- LLM calls used
- LLM calls saved

### 7. LLM provider layer

The provider abstraction lives in `backend/providers/llm.py`.

The app supports:

- Claude
- OpenAI
- Ollama
- AWS Bedrock

Provider selection is controlled by `LLM_PROVIDER`.

All pipeline steps call the same wrapper:

- `call_llm(...)` for provider-specific execution
- `parse_json_response(...)` for cleaning fenced output and parsing JSON safely

This keeps the extraction and analysis logic provider-agnostic.

## Backend Execution Paths

### FastAPI server

The main API is defined in `backend/server.py`.

On startup it:

1. Initializes database tables.
2. Seeds sample shipments if needed.

Core endpoints:

- `GET /api/health`
  Returns backend status, selected LLM provider, shipment count, and latest successful run timestamp.
- `GET /api/shipments`
  Returns all current shipments.
- `GET /api/shipments/{shipment_id}`
  Returns a shipment and its risk history.
- `POST /api/analyze`
  Runs the full pipeline using live news or mock news.
- `POST /api/analyze/mock`
  Shortcut for analysis with bundled mock articles.
- `GET /api/reports/latest`
  Returns the latest successful run with reports, signals, and stats.
- `GET /api/runs`
  Returns recent analysis runs.
- `POST /api/upload-csv`
  Replaces all stored shipments with CSV contents.

Concurrency behavior:

- The server keeps an in-memory `_is_running` flag.
- If a run is already active, a second analyze request returns HTTP `409`.

### CLI mode

The same pipeline can also be run directly from `backend/main.py`.

Supported options:

- `python backend/main.py`
  Use sample shipments and live news
- `python backend/main.py --csv my_shipments.csv`
  Use a custom CSV
- `python backend/main.py --mock-news`
  Use bundled mock articles

The CLI prints a terminal summary and writes JSON output to `outputs/risk_report.json`.

## Frontend Behavior

The frontend is a Next.js application that consumes the FastAPI API through `frontend/lib/api.ts`.

### Global layout

`frontend/app/layout.tsx` provides:

- the left navigation
- backend connection status
- currently selected LLM provider from `/api/health`

### Dashboard

`frontend/app/page.tsx` is the main operational screen.

It:

- loads current shipments
- loads the latest report if available
- lets the user upload a CSV
- lets the user run mock or live analysis
- shows loading step messages during execution
- displays shipment results and extracted signals
- lets the user inspect a selected shipment result in a detail drawer

### Shipments page

`frontend/app/shipments/page.tsx` shows:

- all loaded shipments
- search across ID, vendor, and cities
- latest risk status if a report exists
- CSV upload

Clicking a shipment opens the shipment detail page.

### Shipment detail page

`frontend/app/shipments/[id]/page.tsx` shows:

- shipment metadata
- the latest AI assessment
- historical risk reports for that shipment

This history only works when risk reports are being persisted to the database.

### Reports page

`frontend/app/reports/page.tsx` shows:

- the latest successful run
- summary stats
- risk distribution chart
- expandable risk report cards
- the news signals used in that run

### Runs page

`frontend/app/runs/page.tsx` shows:

- historical run log
- run status
- provider used
- affected shipment counts
- LLM efficiency numbers

## End-to-End Request Flow

When a user clicks `Live Analysis` in the frontend, the full path is:

1. Frontend sends `POST /api/analyze`.
2. Backend creates an `analysis_runs` row with status `running`.
3. Backend loads shipments.
4. Backend fetches live news.
5. Backend extracts signals with one LLM call per article.
6. Backend saves those signals.
7. Backend matches shipments to signals in Python.
8. Backend analyzes only matched shipments with one LLM call per affected shipment.
9. Backend saves risk reports and run statistics.
10. Frontend receives the result and updates the dashboard, reports, and other pages.

If no signals are found:

- the run is completed with status `no_signals`
- no shipment risk reports are generated

If no shipments are affected:

- the run is completed with status `no_affected`
- signals are still returned because they were extracted successfully

If an exception happens:

- the run is marked `failed`
- the error message is stored in `analysis_runs.error_message`

## Why The App Is Efficient

Without filtering, a naive design would compare every shipment to every article using an LLM. That would scale roughly like:

`shipments × articles`

This app reduces cost by splitting the workflow into two LLM phases with a deterministic filter in between:

- Phase 1: article -> structured signal
- Phase 2: affected shipment -> risk report

That means the total LLM calls are approximately:

`articles + affected_shipments`

The app records both `llm_calls_used` and `llm_calls_saved` for each run so this optimization is visible in the UI.

## Configuration Summary

Common environment variables:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/supply_chain_risk
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
AWS_REGION=us-west-2
BEDROCK_MODEL_ID=...
NEWS_API_KEY=...
USE_LOCAL_SAMPLE_SHIPMENTS=false
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

## Current Design Notes

- The frontend always reads from the backend API; it does not contain business logic for risk analysis.
- Matching is intentionally simple and explainable, but it may produce false positives or miss semantic relationships that are not text overlaps.
- The `_is_running` protection is process-local, so it works for a single server instance but is not a distributed lock.
- `GET /api/reports/latest` returns the latest successful run only.
- Uploading a CSV replaces the full shipment table rather than merging selectively.

## Short Summary

This app is a two-stage AI pipeline wrapped in a logistics dashboard:

- news is fetched and converted into structured supply-chain signals
- signals are matched to shipments without AI cost
- only relevant shipments are sent for AI risk scoring
- results, signals, and run stats are stored and displayed in the frontend

That architecture is what makes the system both explainable and cheaper than a naive shipment-by-article analysis approach.
