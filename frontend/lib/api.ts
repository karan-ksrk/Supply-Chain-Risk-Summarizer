// lib/api.ts — typed API client for the FastAPI backend

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Shipment {
  shipment_id: string;
  vendor: string;
  origin_city: string;
  origin_country: string;
  dest_city: string;
  dest_country: string;
  origin_port: string;
  dest_port: string;
  carrier: string;
  transport_mode: string;
  sku: string;
  sku_category: string;
  route: string;
  departure_date: string;
  eta: string;
  freight_cost_usd: number;
}

export interface NewsSignal {
  source_title: string;
  source: string;
  published_at: string;
  risk_type: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  affected_ports: string[];
  affected_cities: string[];
  affected_routes: string[];
  affected_carriers: string[];
}

export interface RiskReport {
  shipment_id: string;
  risk_level: "HIGH" | "MEDIUM" | "LOW";
  delay_estimate: string | null;
  primary_risk: string;
  explanation: string;
  suggested_action: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matched_signals: NewsSignal[];
  // enriched on client
  vendor?: string;
  origin_city?: string;
  dest_city?: string;
  route?: string;
  eta?: string;
  carrier?: string;
}

export interface PipelineStats {
  total_shipments: number;
  articles_fetched: number;
  signals_extracted: number;
  affected_shipments: number;
  high_risk: number;
  medium_risk: number;
  low_risk: number;
  llm_calls_used: number;
  llm_calls_saved: number;
}

export interface AnalysisResult {
  status: "success" | "no_signals" | "no_affected" | "failed";
  run_id: number;
  generated_at: string;
  risk_reports: RiskReport[];
  signals: NewsSignal[];
  stats: PipelineStats;
}

export interface AnalysisRun {
  id: number;
  run_at: string;
  status: string;
  llm_provider: string;
  used_mock_news: boolean;
  affected_shipments: number;
  high_risk: number;
  medium_risk: number;
  llm_calls_used: number;
  llm_calls_saved: number;
}

export interface HealthResponse {
  status: string;
  llm_provider: string;
  shipment_count: number;
  last_run: string | null;
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "API error");
  }
  return res.json();
}

// ── API methods ───────────────────────────────────────────────────────────────

export const api = {
  health: () =>
    apiFetch<HealthResponse>("/health"),

  getShipments: () =>
    apiFetch<{ shipments: Shipment[]; count: number }>("/shipments"),

  getShipment: (id: string) =>
    apiFetch<{ shipment: Shipment; risk_history: RiskReport[] }>(`/shipments/${id}`),

  analyze: (useMockNews = false) =>
    apiFetch<AnalysisResult>("/analyze", {
      method: "POST",
      body: JSON.stringify({ use_mock_news: useMockNews, max_articles: 15 }),
    }),

  analyzeMock: () =>
    apiFetch<AnalysisResult>("/analyze/mock", { method: "POST" }),

  getLatestReport: () =>
    apiFetch<AnalysisResult>("/reports/latest"),

  getRuns: (limit = 20) =>
    apiFetch<{ runs: AnalysisRun[] }>(`/runs?limit=${limit}`),

  uploadCsv: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/upload-csv`, { method: "POST", body: fd }).then((r) =>
      r.json()
    );
  },
};
