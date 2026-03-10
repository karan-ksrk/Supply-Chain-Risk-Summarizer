# Supply Chain Risk Summarizer — Full Stack

## Project Structure

```
supply-chain-risk/          ← pipeline (from previous step)
  core/
  providers/
  data/
  main.py

supply-chain-fullstack/
  backend/
    server.py               ← FastAPI server
  frontend/
    src/
      App.jsx               ← React dashboard
```

---

## Setup

### 1. Install Python dependencies

```bash
cd supply-chain-risk
pip install -r requirements.txt
pip install fastapi uvicorn python-multipart
```

### 2. Configure your .env

```bash
cp .env.example .env
```

Edit `.env`:
```
LLM_PROVIDER=claude          # or openai, ollama
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Start the FastAPI server

```bash
# Run from the root folder (so imports resolve)
uvicorn supply-chain-fullstack.backend.server:app --reload --port 8000
```

Or if running from inside supply-chain-risk/:
```bash
uvicorn backend.server:app --reload --port 8000
```

Test it:
```
http://localhost:8000/docs       ← Swagger UI (auto-generated)
http://localhost:8000/api/health
```

### 4. Start the React frontend

```bash
cd supply-chain-fullstack/frontend
npx create-react-app . --template minimal   # first time only
# Then replace src/App.js with App.jsx content
npm start
```

Or with Vite (faster):
```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install
# Replace src/App.jsx with the provided file
npm run dev
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status + LLM provider info |
| GET | `/api/shipments` | List all loaded shipments |
| POST | `/api/analyze` | Run full pipeline (live news) |
| POST | `/api/analyze/mock` | Run with mock news (no internet) |
| POST | `/api/upload-csv` | Upload custom shipment CSV |
| GET | `/api/reports/latest` | Get last analysis report |

Swagger docs auto-available at: `http://localhost:8000/docs`

---

## How the Pipeline Works

```
[News Fetch] → [Signal Extract — 1 LLM/article] → [Shipment Match — Python only] → [Risk Analyze — 1 LLM/affected shipment]
```

Smart filtering means you use ~90% fewer LLM calls vs naive approach.

---

## Switching LLM Providers

Just change `LLM_PROVIDER` in your `.env`:
```
LLM_PROVIDER=claude    → uses Claude (Anthropic API)
LLM_PROVIDER=openai    → uses GPT-4o-mini
LLM_PROVIDER=ollama    → uses local Llama3 via Ollama
```
