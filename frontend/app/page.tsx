"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import {
  api,
  type AnalysisResult,
  type AnalysisStreamEvent,
  type MapRiskLevel,
  type PaginatedShipmentsResponse,
  type NewsSignal,
  type RiskReport,
  type Shipment,
  type ShipmentMapFeature,
} from "@/lib/api";
import { cn, formatDateTime, getRiskConfig } from "@/lib/utils";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Empty,
  PaginationControls,
  RiskBadge,
  RiskBar,
  Spinner,
  StatCard,
} from "@/components/ui";
import { useAnalysisStore } from "@/lib/store";

const ShipmentMap = dynamic(() => import("@/components/shipment-map"), {
  ssr: false,
  loading: () => (
    <div className="h-[560px] flex items-center justify-center bg-surface border border-border rounded-xl">
      <Spinner size={20} />
    </div>
  ),
});

const STEPS = [
  "Fetching live news...",
  "Extracting risk signals...",
  "Matching shipments...",
  "Running LLM analysis...",
  "Finalizing report...",
];
const STAGE_TO_STEP_INDEX: Record<string, number> = {
  fetching_news: 0,
  extracting_signals: 1,
  matching_shipments: 2,
  analyzing_shipments: 3,
  finalizing: 4,
};
const EMPTY_STATS = {
  total_shipments: 0,
  articles_fetched: 0,
  signals_extracted: 0,
  affected_shipments: 0,
  high_risk: 0,
  medium_risk: 0,
  low_risk: 0,
  llm_calls_used: 0,
  llm_calls_saved: 0,
};

type DashboardTab = "shipments" | "map" | "signals";
type RiskFilter = "ALL" | MapRiskLevel;

type DashboardRow = Shipment &
  Partial<RiskReport> & {
    status: MapRiskLevel;
    matched_signals?: NewsSignal[];
  };

type DrawerSelection = {
  shipment_id: string;
  vendor?: string;
  origin_label: string;
  destination_label: string;
  route_label: string;
  status: MapRiskLevel;
  eta?: string | null;
  carrier?: string | null;
  delay_estimate?: string | null;
  confidence?: string | null;
  explanation?: string | null;
  primary_risk?: string | null;
  suggested_action?: string | null;
  matched_signals: NewsSignal[];
  distance_nm?: number | null;
};

const TABS: DashboardTab[] = ["shipments", "map", "signals"];
const FILTERS: RiskFilter[] = ["ALL", "HIGH", "MEDIUM", "LOW", "PENDING"];
const PAGE_SIZE = 20;
const EMPTY_SHIPMENT_PAGE: PaginatedShipmentsResponse = {
  shipments: [],
  count: 0,
  total: 0,
  page: 1,
  page_size: PAGE_SIZE,
  total_pages: 0,
  summary: { total: 0, sea: 0, air: 0 },
};

function toDrawerSelection(row: DashboardRow): DrawerSelection {
  return {
    shipment_id: row.shipment_id,
    vendor: row.vendor,
    origin_label: row.origin_port || row.origin_city,
    destination_label: row.dest_port || row.dest_city,
    route_label: `${row.origin_city} → ${row.dest_city}`,
    status: row.status,
    eta: row.eta,
    carrier: row.carrier,
    delay_estimate: row.delay_estimate,
    confidence: row.confidence,
    explanation: row.explanation,
    primary_risk: row.primary_risk,
    suggested_action: row.suggested_action,
    matched_signals: row.matched_signals ?? [],
  };
}

function mapFeatureToSelection(feature: ShipmentMapFeature): DrawerSelection {
  const report = feature.risk_report;
  return {
    shipment_id: feature.shipment_id,
    vendor: feature.vendor,
    origin_label: feature.origin.port || feature.origin.city,
    destination_label: feature.destination.port || feature.destination.city,
    route_label: `${feature.origin.city} → ${feature.destination.city}`,
    status: feature.status,
    eta: feature.eta,
    carrier: feature.carrier,
    delay_estimate: report?.delay_estimate,
    confidence: report?.confidence,
    explanation: report?.explanation,
    primary_risk: report?.primary_risk,
    suggested_action: report?.suggested_action,
    matched_signals: report?.matched_signals ?? [],
    distance_nm: feature.route.distance_nm,
  };
}

function DetailDrawer({
  item,
  onClose,
}: {
  item: DrawerSelection;
  onClose: () => void;
}) {
  const c = getRiskConfig(item.status);
  const isPending = item.status === "PENDING";

  return (
    <div className="animate-slide-up">
      <div className={cn("rounded-xl border p-5 mt-4", c.bg, c.border)}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-display font-bold text-[15px] text-primary">
              {item.shipment_id} · {item.vendor ?? "Unknown vendor"}
            </p>
            <p className="text-[11px] text-muted mt-0.5">{item.route_label}</p>
          </div>
          <div className="flex items-center gap-2">
            <RiskBadge level={item.status} />
            <button
              onClick={onClose}
              className="text-muted hover:text-subtle text-base px-1"
            >
              ✕
            </button>
          </div>
        </div>

        {isPending ? (
          <div className="rounded-lg p-4 mb-4 border border-border bg-canvas">
            <p className="text-[9px] text-muted tracking-widest mb-2 uppercase">
              Analysis Pending
            </p>
            <p className="text-[12px] text-subtle leading-relaxed">
              This shipment is visible on the route map, but it does not have a
              risk assessment from the latest run yet.
            </p>
          </div>
        ) : (
          <>
            <div
              className={cn("rounded-lg p-4 mb-4 border-l-[3px]", c.border)}
              style={{ background: "#010409" }}
            >
              <p className="text-[9px] text-muted tracking-widest mb-2 uppercase">
                ◈ AI Risk Analysis
              </p>
              <p className="text-[12px] text-subtle leading-relaxed">
                {item.explanation}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-canvas rounded-lg p-3 border border-border">
                <p className="text-[9px] text-muted tracking-widest uppercase mb-1.5">
                  Primary Risk
                </p>
                <p className="text-[11px] text-primary leading-snug">
                  {item.primary_risk}
                </p>
              </div>
              <div className="bg-canvas rounded-lg p-3 border border-border">
                <p className="text-[9px] text-muted tracking-widest uppercase mb-1.5">
                  Suggested Action
                </p>
                <p className="text-[11px] text-accent leading-snug">
                  {item.suggested_action}
                </p>
              </div>
            </div>
          </>
        )}

        <div className="flex gap-2 flex-wrap mb-4">
          {[
            { label: "ETA", val: item.eta ?? "—" },
            {
              label: "Delay",
              val: item.delay_estimate || (isPending ? "Pending" : "None"),
            },
            { label: "Carrier", val: item.carrier ?? "—" },
            { label: "Confidence", val: item.confidence ?? "—" },
            {
              label: "Distance",
              val: item.distance_nm
                ? `${Math.round(item.distance_nm)} nm`
                : "—",
            },
          ].map(({ label, val }) => (
            <div
              key={label}
              className="bg-canvas border border-border rounded-lg px-3 py-2 flex-1 min-w-[88px]"
            >
              <p className="text-[9px] text-muted tracking-widest uppercase mb-0.5">
                {label}
              </p>
              <p className="text-[11px] text-primary">{val}</p>
            </div>
          ))}
        </div>

        {item.matched_signals.length > 0 && (
          <>
            <p className="text-[9px] text-muted tracking-widest uppercase mb-2">
              Triggering Signals ({item.matched_signals.length})
            </p>
            <div className="flex flex-col gap-2">
              {item.matched_signals.map((sig, i) => (
                <div
                  key={i}
                  className="bg-canvas border border-border rounded-lg px-3 py-2.5"
                >
                  <p className="text-[11px] text-primary">{sig.source_title}</p>
                  <p className="text-[10px] text-muted mt-0.5">
                    {sig.source} · {sig.published_at?.slice(0, 10)}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MapLoadingPanel() {
  return (
    <div className="p-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="h-3 w-[60%] rounded bg-border/70 animate-pulse" />
        <div className="inline-flex items-center gap-2 text-[11px] text-muted">
          <Spinner size={12} />
          Rendering map routes...
        </div>
      </div>
      <div className="h-[560px] rounded-xl border border-border bg-canvas relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-pulse" />
        <div className="absolute left-6 right-6 top-10 h-2 rounded bg-border/60 animate-pulse" />
        <div className="absolute left-10 right-10 top-24 h-2 rounded bg-border/50 animate-pulse" />
        <div className="absolute left-20 right-20 top-40 h-2 rounded bg-border/40 animate-pulse" />
        <div className="absolute left-12 bottom-24 w-2 h-2 rounded-full bg-accent/70 animate-ping" />
        <div className="absolute right-14 top-20 w-2 h-2 rounded-full bg-accent/70 animate-ping" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [shipmentPage, setShipmentPage] =
    useState<PaginatedShipmentsResponse>(EMPTY_SHIPMENT_PAGE);
  const [mapShipments, setMapShipments] = useState<ShipmentMapFeature[]>([]);
  const [mapLoading, setMapLoading] = useState(true);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [selected, setSelected] = useState<DrawerSelection | null>(null);
  const { loading, error, setLoading, setError } = useAnalysisStore();
  const [stepIdx, setStepIdx] = useState(0);
  const [filter, setFilter] = useState<RiskFilter>("ALL");
  const [tab, setTab] = useState<DashboardTab>("shipments");
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(1);

  const loadShipmentPage = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const shipmentsData = await api.getShipments({
          page,
          pageSize: PAGE_SIZE,
          riskStatus: filter === "ALL" ? undefined : filter,
          signal,
        });
        setShipmentPage(shipmentsData);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setShipmentPage(EMPTY_SHIPMENT_PAGE);
        setError("Unable to load dashboard data.");
      }
    },
    [filter, page, setError],
  );

  const refreshAncillaryData = useCallback(
    (signal?: AbortSignal) => {
      setError("");
      setMapLoading(true);

      api
        .getShipmentMap({
          page,
          pageSize: PAGE_SIZE,
          riskStatus: filter === "ALL" ? undefined : filter,
          signal,
        })
        .then((mapData) => {
          setMapShipments(mapData.shipments);
        })
        .catch((err: any) => {
          if (err.name === "AbortError") return;
          setMapShipments([]);
          setError(
            "Dashboard map could not load. Shipment data is still available.",
          );
        })
        .finally(() => {
          if (signal?.aborted) return;
          setMapLoading(false);
        });

      api
        .getLatestReport(signal)
        .then((latest) => {
          setResult(latest);
        })
        .catch((err: any) => {
          if (err.name === "AbortError") return;
          setResult(null);
        });
    },
    [filter, page, setError],
  );

  useEffect(() => {
    const abortController = new AbortController();
    refreshAncillaryData(abortController.signal);
    return () => {
      abortController.abort();
    };
  }, [refreshAncillaryData]);

  useEffect(() => {
    const abortController = new AbortController();
    loadShipmentPage(abortController.signal);
    return () => {
      abortController.abort();
    };
  }, [loadShipmentPage]);

  useEffect(() => {
    if (!loading) setStepIdx(0);
  }, [loading]);

  const runAnalysis = useCallback(
    async (mock: boolean) => {
      setLoading(true);
      setError("");
      setSelected(null);
      setStepIdx(0);
      try {
        await api.analyzeStream(mock, (event: AnalysisStreamEvent) => {
          if (event.type === "stage") {
            const idx = STAGE_TO_STEP_INDEX[event.stage];
            if (typeof idx === "number") setStepIdx(idx);
            return;
          }

          if (event.type === "start") {
            setResult({
              status: "success",
              run_id: event.run_id,
              generated_at: event.generated_at,
              risk_reports: [],
              signals: [],
              stats: { ...EMPTY_STATS },
            });
            return;
          }

          if (event.type === "signal") {
            setResult((prev) => {
              const current: AnalysisResult = prev ?? {
                status: "success",
                run_id: 0,
                generated_at: new Date().toISOString(),
                risk_reports: [],
                signals: [],
                stats: { ...EMPTY_STATS },
              };
              return {
                ...current,
                signals: [...current.signals, event.signal],
                stats: {
                  ...current.stats,
                  signals_extracted: current.signals.length + 1,
                },
              };
            });
            return;
          }

          if (event.type === "matched_shipments") {
            setResult((prev) => {
              const current: AnalysisResult = prev ?? {
                status: "success",
                run_id: 0,
                generated_at: new Date().toISOString(),
                risk_reports: [],
                signals: [],
                stats: { ...EMPTY_STATS },
              };
              return {
                ...current,
                stats: {
                  ...current.stats,
                  total_shipments: event.total_shipments,
                  affected_shipments: event.affected_shipments,
                },
              };
            });
            return;
          }

          if (event.type === "risk_report") {
            setResult((prev) => {
              const current: AnalysisResult = prev ?? {
                status: "success",
                run_id: 0,
                generated_at: new Date().toISOString(),
                risk_reports: [],
                signals: [],
                stats: { ...EMPTY_STATS },
              };
              const nextReports = [...current.risk_reports, event.report];
              const high = nextReports.filter(
                (r) => r.risk_level === "HIGH",
              ).length;
              const medium = nextReports.filter(
                (r) => r.risk_level === "MEDIUM",
              ).length;

              return {
                ...current,
                risk_reports: nextReports,
                stats: {
                  ...current.stats,
                  affected_shipments: nextReports.length,
                  high_risk: high,
                  medium_risk: medium,
                  low_risk: nextReports.length - high - medium,
                },
              };
            });
            return;
          }

          if (event.type === "complete") {
            setResult(event.result);
          }
        });
        refreshAncillaryData();
        await loadShipmentPage();
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setError(
            e.message ||
              "Analysis failed. Is the FastAPI server running on :8000?",
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [loadShipmentPage, refreshAncillaryData, setLoading, setError],
  );

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const res = await api.uploadCsv(file);
      if (res.status === "ok") {
        setResult(null);
        setSelected(null);
        setPage(1);
        refreshAncillaryData();
      } else {
        setError(res.detail || "Upload failed");
      }
    } catch (err: any) {
      setError(err.message || "Upload failed. Is the FastAPI server running on :8000?");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const shipments = shipmentPage.shipments;
  const totalShipments = result?.stats?.total_shipments ?? shipmentPage.total;

  const enriched = shipments.map((shipment) => {
    const report = result?.risk_reports?.find(
      (r) => r.shipment_id === shipment.shipment_id,
    );
    return {
      ...shipment,
      ...(report ?? {}),
      status: (report?.risk_level ?? "PENDING") as MapRiskLevel,
    };
  }) as DashboardRow[];

  const filteredRows =
    filter === "ALL"
      ? enriched
      : enriched.filter((shipment) => shipment.status === filter);
  const filteredMap =
    filter === "ALL"
      ? mapShipments
      : mapShipments.filter((shipment) => shipment.status === filter);
  const stats = result?.stats;
  const signals = result?.signals ?? [];
  const pendingCount =
    totalShipments -
    (stats?.affected_shipments ?? result?.risk_reports.length ?? 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-extrabold text-[22px] text-primary tracking-tight">
            Risk Dashboard
          </h1>
          <p className="text-[12px] text-muted mt-0.5">
            {result
              ? `Last run: ${formatDateTime(result.generated_at)}`
              : "No analysis run yet"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] cursor-pointer bg-surface border border-border text-subtle hover:text-primary transition-colors",
              uploading && "opacity-50 pointer-events-none",
            )}
          >
            {uploading ? <Spinner size={12} /> : "↑"} Upload CSV
            <input
              type="file"
              accept=".csv"
              onChange={handleUpload}
              className="hidden"
            />
          </label>
          <Button
            onClick={() => runAnalysis(true)}
            disabled={loading}
            variant="ghost"
          >
            {loading ? <Spinner size={12} /> : "⚙"} Mock News
          </Button>
          <Button onClick={() => runAnalysis(false)} disabled={loading}>
            {loading ? <Spinner size={12} /> : "▶"} Live Analysis
          </Button>
        </div>
      </div>

      {error && <Alert message={error} onClose={() => setError("")} />}

      {loading && (
        <div className="bg-surface border border-border rounded-xl px-5 py-4 mb-5 flex items-center gap-4 animate-fade-in">
          <Spinner size={16} />
          <div>
            <p className="text-[12px] text-accent font-medium">
              {STEPS[stepIdx]}
            </p>
            <p className="text-[10px] text-muted mt-0.5">
              Smart filtering active — only affected shipments go to LLM
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Shipments"
          value={shipments.length}
          sub="Loaded"
          accentColor="#1f6feb"
          icon="◫"
        />
        <StatCard
          label="High Risk"
          value={stats?.high_risk ?? 0}
          sub="Immediate action"
          accentColor="#ef4444"
          icon="⚠"
        />
        <StatCard
          label="Medium Risk"
          value={stats?.medium_risk ?? 0}
          sub="Monitor closely"
          accentColor="#f59e0b"
          icon="◉"
        />
        <StatCard
          label="On Map"
          value={mapShipments.length}
          sub="Routes rendered"
          accentColor="#8b5cf6"
          icon="⊕"
        />
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-4">
        <div>
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-[11px] uppercase tracking-widest transition-colors",
                    tab === t
                      ? "bg-border text-primary"
                      : "text-muted hover:text-subtle",
                  )}
                >
                  {t}
                  {t === "signals" && signals.length > 0
                    ? ` (${signals.length})`
                    : ""}
                  {t === "map" && mapShipments.length > 0
                    ? ` (${mapShipments.length})`
                    : ""}
                </button>
              ))}
            </div>

            {(tab === "shipments" || tab === "map") && (
              <div className="flex gap-2 flex-wrap justify-end">
                {FILTERS.map((value) => {
                  const c = value !== "ALL" ? getRiskConfig(value) : null;
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        setFilter(value);
                        setPage(1);
                      }}
                      className={cn(
                        "px-3 py-1 rounded-full text-[10px] tracking-widest border transition-all",
                        filter === value
                          ? c
                            ? cn(c.bg, c.border, c.text)
                            : "bg-accent/10 border-accent text-accent"
                          : "bg-surface border-border text-muted hover:text-subtle",
                      )}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {tab === "shipments" && (
            <Card>
              <div className="grid grid-cols-[100px_1.5fr_1.5fr_110px_110px_100px] px-5 py-2.5 border-b border-border text-[9px] text-muted uppercase tracking-widest">
                <span>ID</span>
                <span>Vendor</span>
                <span>Route</span>
                <span>ETA</span>
                <span>Status</span>
                <span>Delay</span>
              </div>
              {filteredRows.length === 0 ? (
                <Empty
                  message={
                    shipmentPage.total === 0
                      ? "No shipments loaded"
                      : "No shipments match filter"
                  }
                />
              ) : (
                filteredRows.map((shipment) => {
                  const isSel = selected?.shipment_id === shipment.shipment_id;
                  return (
                    <div
                      key={shipment.shipment_id}
                      onClick={() =>
                        setSelected(isSel ? null : toDrawerSelection(shipment))
                      }
                      className={cn(
                        "grid grid-cols-[100px_1.5fr_1.5fr_110px_110px_100px] px-5 py-3 border-b border-border/50 cursor-pointer transition-colors",
                        isSel ? "bg-white/[0.03]" : "hover:bg-white/[0.02]",
                      )}
                    >
                      <span className="text-accent text-[12px]">
                        {shipment.shipment_id}
                      </span>
                      <span className="text-primary text-[12px]">
                        {shipment.vendor}
                      </span>
                      <span className="text-muted text-[11px]">
                        {shipment.origin_city} → {shipment.dest_city}
                      </span>
                      <span className="text-subtle text-[11px]">
                        {shipment.eta?.slice(5) ?? "—"}
                      </span>
                      <span>
                        <RiskBadge level={shipment.status} />
                      </span>
                      <span
                        className={cn(
                          "text-[12px]",
                          shipment.delay_estimate &&
                            shipment.delay_estimate !== "None"
                            ? "text-red-400"
                            : "text-emerald-400",
                        )}
                      >
                        {shipment.delay_estimate &&
                        shipment.delay_estimate !== "None"
                          ? shipment.delay_estimate
                          : shipment.status === "PENDING"
                            ? "Pending"
                            : "On time"}
                      </span>
                    </div>
                  );
                })
              )}
              <PaginationControls
                page={shipmentPage.page}
                totalPages={shipmentPage.total_pages}
                totalItems={shipmentPage.total}
                pageSize={shipmentPage.page_size}
                onPageChange={setPage}
              />
            </Card>
          )}

          {tab === "map" && (
            <Card className="overflow-hidden">
              <CardHeader
                title="Shipment Route Map"
                right={
                  <span>
                    {mapLoading
                      ? "Loading routes..."
                      : `${filteredMap.length} routes visible`}
                  </span>
                }
              />
              {mapLoading ? (
                <MapLoadingPanel />
              ) : mapShipments.length === 0 ? (
                <Empty message="No shipment routes available yet" />
              ) : (
                <div className="p-4">
                  <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <p className="text-[11px] text-muted">
                      Sea shipments use backend-generated SeaRoute library
                      geometry when available. Other shipments fall back to
                      straight-line routing.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {FILTERS.filter((value) => value !== "ALL").map(
                        (value) => (
                          <span
                            key={value}
                            className={cn(
                              "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] border",
                              getRiskConfig(value).bg,
                              getRiskConfig(value).border,
                              getRiskConfig(value).text,
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                getRiskConfig(value).dot,
                              )}
                            />
                            {value}
                          </span>
                        ),
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl overflow-hidden border border-border">
                    <ShipmentMap
                      shipments={filteredMap}
                      selectedShipmentId={selected?.shipment_id}
                      onSelect={(feature) =>
                        setSelected(mapFeatureToSelection(feature))
                      }
                    />
                  </div>

                  <PaginationControls
                    page={shipmentPage.page}
                    totalPages={shipmentPage.total_pages}
                    totalItems={shipmentPage.total}
                    pageSize={shipmentPage.page_size}
                    onPageChange={setPage}
                  />
                </div>
              )}
            </Card>
          )}

          {tab === "signals" && (
            <Card>
              {signals.length === 0 ? (
                <Empty message="Run analysis to fetch news signals" />
              ) : (
                signals.map((sig: NewsSignal, i: number) => {
                  const c = getRiskConfig(sig.severity);
                  return (
                    <div
                      key={i}
                      className="px-5 py-3.5 border-b border-border/50"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span
                          className={cn(
                            "text-[10px] font-semibold tracking-wide",
                            c.text,
                          )}
                        >
                          {sig.risk_type}
                        </span>
                        <span className="text-[10px] text-muted">
                          {sig.published_at?.slice(0, 10)}
                        </span>
                      </div>
                      <p className="text-[12px] text-primary mb-2">
                        {sig.source_title}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        <RiskBadge level={sig.severity} />
                        {sig.affected_routes?.slice(0, 2).map((route) => (
                          <span
                            key={route}
                            className="text-[10px] text-muted bg-border/50 border border-border rounded px-2 py-0.5"
                          >
                            {route}
                          </span>
                        ))}
                        {sig.affected_ports?.slice(0, 2).map((port) => (
                          <span
                            key={port}
                            className="text-[10px] text-muted bg-border/50 border border-border rounded px-2 py-0.5"
                          >
                            {port}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </Card>
          )}

          {selected && (
            <DetailDrawer item={selected} onClose={() => setSelected(null)} />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Risk Breakdown"
              right={`${result?.risk_reports.length ?? 0} affected`}
            />
            <div className="p-4">
              {totalShipments > 0 ? (
                <>
                  <RiskBar
                    level="HIGH"
                    count={stats?.high_risk ?? 0}
                    total={totalShipments}
                  />
                  <RiskBar
                    level="MEDIUM"
                    count={stats?.medium_risk ?? 0}
                    total={totalShipments}
                  />
                  <RiskBar
                    level="LOW"
                    count={stats?.low_risk ?? 0}
                    total={totalShipments}
                  />
                  <RiskBar
                    level="PENDING"
                    count={Math.max(0, pendingCount)}
                    total={totalShipments}
                  />
                </>
              ) : (
                <Empty message="Load shipments to see breakdown" />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Top Risks"
              right={`${stats?.high_risk ?? 0} critical`}
            />
            {enriched.filter((shipment) => shipment.status !== "PENDING")
              .length === 0 ? (
              <Empty message="No risks detected yet" />
            ) : (
              [...enriched]
                .filter((shipment) => shipment.status !== "PENDING")
                .sort(
                  (a, b) =>
                    FILTERS.indexOf(a.status) - FILTERS.indexOf(b.status),
                )
                .slice(0, 5)
                .map((shipment) => {
                  const c = getRiskConfig(shipment.status);
                  return (
                    <div
                      key={shipment.shipment_id}
                      onClick={() => {
                        setSelected(toDrawerSelection(shipment));
                        setTab("shipments");
                        setFilter("ALL");
                      }}
                      className="px-4 py-3 border-b border-border/50 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-accent text-[11px]">
                          {shipment.shipment_id}
                        </span>
                        <RiskBadge level={shipment.status} />
                      </div>
                      <p className="text-[11px] text-subtle">
                        {shipment.vendor}
                      </p>
                      <p className={cn("text-[10px] mt-0.5", c.text)}>
                        {shipment.delay_estimate &&
                        shipment.delay_estimate !== "None"
                          ? shipment.delay_estimate
                          : "No delay"}
                      </p>
                    </div>
                  );
                })
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
