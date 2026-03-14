# API Reference - Supply Chain Risk Summarizer

Base URL (local default): `http://localhost:8000/api`

## 1) Health

### `GET /health`

Returns backend health and summary metadata.

Response shape:

```json
{
  "status": "ok",
  "llm_provider": "claude",
  "shipment_count": 7,
  "last_run": "2026-03-14T12:34:56.000000",
  "using_local_sample_shipments": false
}
```

## 2) Shipments

### `GET /shipments`

Query params:

- `page` (default `1`, min `1`)
- `page_size` (default `20`, min `1`, max `100`)
- `q` (optional search by id/vendor/city/port/carrier)
- `risk_status` (optional: `HIGH|MEDIUM|LOW|PENDING`)
- `run_id` (optional, use reports from specific run)

Response shape:

```json
{
  "shipments": [],
  "count": 20,
  "total": 128,
  "page": 1,
  "page_size": 20,
  "total_pages": 7,
  "summary": { "total": 128, "sea": 120, "air": 8 }
}
```

### `GET /shipments/map`

Same query params as `/shipments`.  
Returns map-friendly shipment features with route geometry and risk status.

Response shape:

```json
{
  "shipments": [
    {
      "shipment_id": "IMO-9930806",
      "origin": { "lat": 37.45, "lng": 126.70 },
      "destination": { "lat": 26.64, "lng": 50.15 },
      "route": {
        "kind": "searoute",
        "source": "searoute-library",
        "distance_nm": 5234.0,
        "coordinates": [[126.7, 37.4], [50.1, 26.6]]
      },
      "status": "HIGH",
      "risk_report": {}
    }
  ],
  "count": 15,
  "total": 128,
  "page": 1,
  "page_size": 15,
  "total_pages": 9
}
```

### `GET /shipments/{shipment_id}`

Returns shipment details plus risk history for that shipment.

## 3) Analysis

### `POST /analyze`

Starts an analysis run and returns final result once complete.

Request body:

```json
{
  "use_mock_news": false,
  "max_articles": 15,
  "signal_batch_size": 5,
  "risk_batch_size": 4
}
```

Statuses in response:

- `success`
- `no_signals`
- `no_affected`
- `failed`

### `POST /analyze/stream`

Same request body as `/analyze`, but streams progress via SSE.

Common event types:

- `start`
- `stage`
- `signal`
- `signal_skipped`
- `signal_error`
- `matched_shipments`
- `risk_report`
- `risk_report_error`
- `complete`
- `error`

### `POST /analyze/mock`

Shortcut endpoint for deterministic mock-news run.

## 4) Reports and Runs

### `GET /reports/latest`

Returns latest run payload:

- `status`
- `run_id`
- `generated_at`
- `risk_reports[]`
- `signals[]`
- `stats`

### `GET /runs`

Query params:

- `limit` (default `20`)

Returns recent run summaries.

## 5) Data Management

### `POST /upload-csv`

Form-data:

- `file`: CSV file

Behavior:

- validates `.csv` extension
- parses rows
- deletes all existing shipments
- inserts uploaded shipments

### `DELETE /clear`

Clears database tables:

- shipments
- analysis runs
- news signals
- risk reports
- route cache

## 6) Error Codes

Common API errors:

- `400` invalid request (example: wrong CSV type, invalid risk status)
- `404` missing resources (example: no report yet, unknown shipment id)
- `409` analysis already running
- `500` pipeline/server exceptions

## 7) Notes for Integrators

- For real-time UX, prefer `/analyze/stream`.
- Use `/runs` for audit history dashboards.
- Use `run_id` filters on shipment endpoints to inspect status against a specific run.
