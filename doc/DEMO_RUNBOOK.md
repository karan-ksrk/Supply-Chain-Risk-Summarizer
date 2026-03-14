# Demo Runbook - Hackathon Judge Presentation

This runbook is designed for a 5-8 minute reliable demo.

## 1) Prerequisites

- Python 3.10+ (3.12 recommended)
- Node.js 18+ and npm
- PostgreSQL running with a valid `DATABASE_URL`

## 2) Environment Setup

Create/update `.env` at repo root (or use `backend/.env.example` as template):

```env
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20240620-v1:0
NEWS_API_KEY=your_newsapi_key_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/supply_chain_risk
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

Optional local-only shipment mode:

```env
USE_LOCAL_SAMPLE_SHIPMENTS=true
```

## 3) Start Backend

From repo root:

```bash
pip install -r backend/requirements.txt
uvicorn backend.server:app --reload --port 8000
```

Verify:

- `http://localhost:8000/api/health`
- `http://localhost:8000/docs`

## 4) Start Frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open:

- `http://localhost:3000`

## 5) Judge Demo Script (Recommended)

### Step A - Show Problem Context (45 sec)

- Open Dashboard.
- Explain that logistics disruptions happen in unstructured news.
- Explain that manual mapping from article -> affected shipment is slow.

### Step B - Run Deterministic Demo (90 sec)

- Click `Mock News`.
- Point out streaming stages:
  - fetching news
  - extracting signals
  - matching shipments
  - analyzing affected shipments
  - finalizing
- Explain: only affected shipments go to final LLM analysis.

### Step C - Show Results Quality (90 sec)

- In dashboard table, open one high-risk shipment detail drawer.
- Show explanation, primary risk, delay estimate, suggested action.
- Switch to `Signals` tab and show source-linked extracted signals.

### Step D - Show Operational Visibility (60 sec)

- Open map tab.
- Highlight route lines and risk color coding.
- Mention sea routes use searoute geometry when available, otherwise fallback routing.

### Step E - Show Auditability (45 sec)

- Open `Reports` page: risk distribution and detailed cards.
- Open `Run History`: show each run status/provider and efficiency metrics.

### Step F - Optional Live Mode (45 sec)

- Run `Live Analysis`.
- Mention NewsAPI -> Google RSS fallback strategy.

## 6) Backup Plan If External APIs Fail

Use mock mode only:

- frontend `Mock News` button
- or backend `POST /api/analyze/mock`

This keeps the demo stable even without external news/LLM/network dependencies.

## 7) Talking Points Judges Usually Ask

### "What is technically novel?"

- Hybrid architecture: batched extraction + deterministic matcher + targeted risk inference.
- Built-in measurable AI efficiency (`llm_calls_saved`).

### "How is it production-practical?"

- Persistent run history and risk reports in PostgreSQL.
- Route cache for map performance.
- Multi-provider LLM abstraction.
- CSV ingestion for real datasets.

### "How do you handle failures?"

- explicit run statuses (`failed`, `no_signals`, `no_affected`)
- error logging in run records
- safe demo mode (`mock-news`)

## 8) Useful Manual Test Calls

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/runs
curl -X POST http://localhost:8000/api/analyze/mock -H "Content-Type: application/json"
curl http://localhost:8000/api/reports/latest
```

## 9) Reset State Before Final Demo

```bash
curl -X DELETE http://localhost:8000/api/clear
```

Then run mock analysis once to preload a fresh result set.
