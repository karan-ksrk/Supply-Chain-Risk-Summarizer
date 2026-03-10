# Supply Chain Risk Summarizer

FastAPI backend for analyzing shipment risk from logistics news signals. The app fetches or mocks news, extracts structured disruption signals with an LLM, matches those signals against shipments, and stores run history in PostgreSQL.

## Repo Layout

```text
backend/
  core/          Risk extraction, matching, and analysis logic
  data/          Sample shipment data
  db/            SQLAlchemy models, CRUD, and database setup
  providers/     LLM provider adapter layer
  server.py      FastAPI app entrypoint
  main.py        CLI pipeline entrypoint
  requirements.txt
frontend/        Frontend workspace placeholder
```

## Requirements

- Python 3.12 recommended
- PostgreSQL running locally or a reachable `DATABASE_URL`
- One configured LLM provider: `claude`, `openai`, or `ollama`

## Backend Setup

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r backend/requirements.txt
pip install fastapi uvicorn python-multipart sqlalchemy psycopg2-binary
```

3. Create a root `.env` or copy from `backend/.env.example`.

Required environment values:

```env
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
NEWS_API_KEY=your_key_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/supply_chain_risk
```

## Run The API

Start the FastAPI app from the repo root:

```bash
uvicorn backend.server:app --reload --port 8000
```

Docs and health endpoints:

- `http://localhost:8000/docs`
- `http://localhost:8000/api/health`

Important: application startup initializes the database immediately. If PostgreSQL credentials in `DATABASE_URL` are wrong, startup will fail before the API begins serving requests.

## API Endpoints

- `GET /api/health` returns service status and latest run metadata.
- `GET /api/shipments` lists shipments in the database.
- `GET /api/shipments/{shipment_id}` returns one shipment and its risk history.
- `POST /api/analyze` runs analysis with live news.
- `POST /api/analyze/mock` runs analysis with bundled mock news.
- `GET /api/reports/latest` returns the latest report and signals.
- `GET /api/runs` lists recent runs.
- `POST /api/upload-csv` replaces shipments from an uploaded CSV.

## Run The CLI Pipeline

You can also run the non-API pipeline:

```bash
python backend/main.py --mock-news
python backend/main.py --csv path/to/shipments.csv
```

## Processing Flow

```text
News fetch -> signal extraction -> shipment matching -> risk analysis -> DB persistence
```

The matching step filters shipments before final risk analysis, which reduces LLM calls compared with a naive shipment-by-article approach.
