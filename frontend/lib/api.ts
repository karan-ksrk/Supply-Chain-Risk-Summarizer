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
  created_at?: string;
}

export type MapRiskLevel = "HIGH" | "MEDIUM" | "LOW" | "PENDING";

export interface ShipmentMapLocation {
  city: string;
  country: string;
  port: string;
  lat: number | null;
  lng: number | null;
}

export interface ShipmentMapRoute {
  kind: "searoute" | "fallback";
  coordinates: [number, number][];
  distance_nm?: number | null;
  source: "searoute-library" | "fallback";
}

export interface ShipmentMapFeature {
  shipment_id: string;
  vendor: string;
  transport_mode: string;
  carrier: string;
  eta: string;
  origin: ShipmentMapLocation;
  destination: ShipmentMapLocation;
  route: ShipmentMapRoute;
  status: MapRiskLevel;
  risk_report: RiskReport | null;
}

export interface ShipmentMapResponse {
  shipments: ShipmentMapFeature[];
  count: number;
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ShipmentSummary {
  total: number;
  sea: number;
  air: number;
}

export interface PaginatedShipmentsResponse {
  shipments: Shipment[];
  count: number;
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  summary: ShipmentSummary;
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

export type AnalysisStreamEvent =
  | { type: "start"; run_id: number; generated_at: string }
  | { type: "stage"; stage: string; message: string; [key: string]: unknown }
  | { type: "signal"; index: number; total: number; signal: NewsSignal }
  | { type: "signal_skipped"; index: number; total: number; article_title: string }
  | { type: "signal_error"; index: number; total: number; article_title: string; message: string }
  | { type: "matched_shipments"; affected_shipments: number; total_shipments: number }
  | { type: "risk_report"; index: number; total: number; report: RiskReport }
  | { type: "risk_report_error"; index: number; total: number; shipment_id?: string; message: string }
  | { type: "error"; message: string }
  | { type: "complete"; result: AnalysisResult };

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

export interface UploadCsvResponse {
  status: "ok" | "error";
  count?: number;
  preview?: Record<string, unknown>[];
  detail?: string;
}

export interface GetShipmentsParams {
  page?: number;
  pageSize?: number;
  q?: string;
  riskStatus?: MapRiskLevel;
  signal?: AbortSignal;
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit & { signal?: AbortSignal }): Promise<T> {
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
  health: (signal?: AbortSignal) =>
    apiFetch<HealthResponse>("/health", { signal }),

  getShipments: ({ page = 1, pageSize = 20, q, riskStatus, signal }: GetShipmentsParams = {}) => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (q && q.trim()) params.set("q", q.trim());
    if (riskStatus) params.set("risk_status", riskStatus);
    return apiFetch<PaginatedShipmentsResponse>(`/shipments?${params.toString()}`, { signal });
  },

  getShipment: (id: string, signal?: AbortSignal) =>
    apiFetch<{ shipment: Shipment; risk_history: RiskReport[] }>(`/shipments/${id}`, { signal }),

  getShipmentMap: ({ page = 1, pageSize = 20, q, riskStatus, signal }: GetShipmentsParams = {}) => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (q && q.trim()) params.set("q", q.trim());
    if (riskStatus) params.set("risk_status", riskStatus);
    return apiFetch<ShipmentMapResponse>(`/shipments/map?${params.toString()}`, { signal });
  },

  analyze: (useMockNews = false) =>
    apiFetch<AnalysisResult>("/analyze", {
      method: "POST",
      body: JSON.stringify({ use_mock_news: useMockNews, max_articles: 15 }),
    }),

  analyzeStream: async (
    useMockNews = false,
    onEvent?: (event: AnalysisStreamEvent) => void,
    signal?: AbortSignal,
  ) => {
    const res = await fetch(`${BASE}/analyze/stream`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ use_mock_news: useMockNews, max_articles: 15 }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "API error");
    }

    if (!res.body) throw new Error("Streaming response is not available.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: AnalysisResult | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");

        if (!data) continue;

        const event = JSON.parse(data) as AnalysisStreamEvent;
        onEvent?.(event);

        if (event.type === "error") {
          throw new Error(event.message || "Analysis failed.");
        }
        if (event.type === "complete") {
          finalResult = event.result;
        }
      }
    }

    if (!finalResult) {
      throw new Error("Stream ended before completion.");
    }
    return finalResult;
  },

  analyzeMock: () =>
    apiFetch<AnalysisResult>("/analyze/mock", { method: "POST" }),

  getLatestReport: (signal?: AbortSignal) =>
    apiFetch<AnalysisResult>("/reports/latest", { signal }),

  getRuns: (limit = 20, signal?: AbortSignal) =>
    apiFetch<{ runs: AnalysisRun[] }>(`/runs?limit=${limit}`, { signal }),

  uploadCsv: async (file: File): Promise<UploadCsvResponse> => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${BASE}/upload-csv`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.detail || "Upload failed");
      }
      return body as UploadCsvResponse;
    } catch (err: any) {
      if (err instanceof TypeError) {
        throw new Error(
          `Unable to reach backend API (${BASE}). Ensure FastAPI is running on port 8000.`,
        );
      }
      throw err;
    }
  },
};
