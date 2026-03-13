"use client";
import { useEffect, useState, useCallback } from "react";
import { api, type AnalysisResult, type Shipment, type RiskReport, type NewsSignal } from "@/lib/api";
import { getRiskConfig, formatDateTime, cn } from "@/lib/utils";
import { StatCard, RiskBadge, Card, CardHeader, Button, Spinner, RiskBar, Alert, Empty } from "@/components/ui";

// ── Loading steps animation ───────────────────────────────────────────────────
const STEPS = [
  "Fetching live news...",
  "Extracting risk signals...",
  "Matching shipments...",
  "Running LLM analysis...",
  "Finalizing report...",
];

// ── Selected shipment detail drawer ──────────────────────────────────────────
function DetailDrawer({ report, shipment, onClose }: {
  report: RiskReport; shipment?: Shipment; onClose: () => void;
}) {
  const c = getRiskConfig(report.risk_level);
  return (
    <div className="animate-slide-up">
      <div className={cn("rounded-xl border p-5 mt-4", c.bg, c.border)}>
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-display font-bold text-[15px] text-primary">
              {report.shipment_id} · {shipment?.vendor ?? report.vendor}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              {shipment?.origin_city} → {shipment?.dest_city} · {shipment?.route}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RiskBadge level={report.risk_level} />
            <button onClick={onClose} className="text-muted hover:text-subtle text-base px-1">✕</button>
          </div>
        </div>

        {/* AI explanation */}
        <div className={cn("rounded-lg p-4 mb-4 border-l-[3px]", c.border)} style={{ background: "#010409" }}>
          <p className="text-[9px] text-muted tracking-widest mb-2 uppercase">◈ AI Risk Analysis</p>
          <p className="text-[12px] text-subtle leading-relaxed">{report.explanation}</p>
        </div>

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-canvas rounded-lg p-3 border border-border">
            <p className="text-[9px] text-muted tracking-widest uppercase mb-1.5">Primary Risk</p>
            <p className="text-[11px] text-primary leading-snug">{report.primary_risk}</p>
          </div>
          <div className="bg-canvas rounded-lg p-3 border border-border">
            <p className="text-[9px] text-muted tracking-widest uppercase mb-1.5">Suggested Action</p>
            <p className="text-[11px] text-accent leading-snug">{report.suggested_action}</p>
          </div>
        </div>

        {/* Meta pills */}
        <div className="flex gap-2 flex-wrap mb-4">
          {[
            { label: "ETA",       val: shipment?.eta ?? "—" },
            { label: "Delay",     val: report.delay_estimate || "None" },
            { label: "Carrier",   val: shipment?.carrier ?? "—" },
            { label: "Confidence",val: report.confidence },
          ].map(({ label, val }) => (
            <div key={label} className="bg-canvas border border-border rounded-lg px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-[9px] text-muted tracking-widest uppercase mb-0.5">{label}</p>
              <p className="text-[11px] text-primary">{val}</p>
            </div>
          ))}
        </div>

        {/* Triggering signals */}
        {report.matched_signals?.length > 0 && (
          <>
            <p className="text-[9px] text-muted tracking-widest uppercase mb-2">Triggering Signals ({report.matched_signals.length})</p>
            <div className="flex flex-col gap-2">
              {report.matched_signals.map((sig, i) => (
                <div key={i} className="bg-canvas border border-border rounded-lg px-3 py-2.5">
                  <p className="text-[11px] text-primary">{sig.source_title}</p>
                  <p className="text-[10px] text-muted mt-0.5">{sig.source} · {sig.published_at?.slice(0, 10)}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [shipments, setShipments]   = useState<Shipment[]>([]);
  const [result, setResult]         = useState<AnalysisResult | null>(null);
  const [selected, setSelected]     = useState<RiskReport | null>(null);
  const [loading, setLoading]       = useState(false);
  const [stepIdx, setStepIdx]       = useState(0);
  const [filter, setFilter]         = useState<string>("ALL");
  const [tab, setTab]               = useState<"shipments" | "signals">("shipments");
  const [error, setError]           = useState("");
  const [uploading, setUploading]   = useState(false);

  // Boot
  useEffect(() => {
    api.getShipments().then(d => setShipments(d.shipments)).catch(() => {});
    api.getLatestReport().then(d => setResult(d)).catch(() => {});
  }, []);

  // Loading stepper
  useEffect(() => {
    if (!loading) { setStepIdx(0); return; }
    const t = setInterval(() => setStepIdx(i => (i + 1) % STEPS.length), 1800);
    return () => clearInterval(t);
  }, [loading]);

  const runAnalysis = useCallback(async (mock: boolean) => {
    setLoading(true); setError(""); setSelected(null);
    try {
      const data = mock ? await api.analyzeMock() : await api.analyze(false);
      if ("detail" in data) throw new Error((data as any).detail);
      setResult(data);
      api.getShipments().then(d => setShipments(d.shipments));
    } catch (e: any) {
      setError(e.message || "Analysis failed. Is the FastAPI server running on :8000?");
    } finally { setLoading(false); }
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    const res = await api.uploadCsv(file);
    setUploading(false);
    if (res.status === "ok") {
      api.getShipments().then(d => setShipments(d.shipments));
      setResult(null); setSelected(null);
    } else { setError(res.detail || "Upload failed"); }
    e.target.value = "";
  };

  // Enrich reports with shipment data
  const enriched = (result?.risk_reports ?? []).map(r => ({
    ...r, ...shipments.find(s => s.shipment_id === r.shipment_id),
    risk_level: r.risk_level,
  })) as (RiskReport & Shipment)[];

  const allRows = shipments.map(s => ({
    ...s,
    ...(enriched.find(r => r.shipment_id === s.shipment_id) ?? {}),
  }));

  const filtered = filter === "ALL" ? allRows : allRows.filter(s => (s as any).risk_level === filter);
  const stats = result?.stats;
  const signals = result?.signals ?? [];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-extrabold text-[22px] text-primary tracking-tight">Risk Dashboard</h1>
          <p className="text-[12px] text-muted mt-0.5">
            {result ? `Last run: ${formatDateTime(result.generated_at)}` : "No analysis run yet"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] cursor-pointer bg-surface border border-border text-subtle hover:text-primary transition-colors", uploading && "opacity-50 pointer-events-none")}>
            {uploading ? <Spinner size={12} /> : "↑"} Upload CSV
            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
          </label>
          <Button onClick={() => runAnalysis(true)} disabled={loading} variant="ghost">
            {loading ? <Spinner size={12} /> : "⚙"} Mock News
          </Button>
          <Button onClick={() => runAnalysis(false)} disabled={loading}>
            {loading ? <Spinner size={12} /> : "▶"} Live Analysis
          </Button>
        </div>
      </div>

      {error && <Alert message={error} onClose={() => setError("")} />}

      {/* ── Loading bar ── */}
      {loading && (
        <div className="bg-surface border border-border rounded-xl px-5 py-4 mb-5 flex items-center gap-4 animate-fade-in">
          <Spinner size={16} />
          <div>
            <p className="text-[12px] text-accent font-medium">{STEPS[stepIdx]}</p>
            <p className="text-[10px] text-muted mt-0.5">Smart filtering active — only affected shipments go to LLM</p>
          </div>
        </div>
      )}

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatCard label="Shipments" value={stats?.total_shipments ?? shipments.length} sub="Loaded" accentColor="#1f6feb" icon="◫" />
        <StatCard label="High Risk" value={stats?.high_risk ?? 0} sub="Immediate action" accentColor="#ef4444" icon="⚠" />
        <StatCard label="Medium Risk" value={stats?.medium_risk ?? 0} sub="Monitor closely" accentColor="#f59e0b" icon="◉" />
        <StatCard label="Signals" value={stats?.signals_extracted ?? 0} sub="News matched" accentColor="#8b5cf6" icon="⊕" />
        {/* <StatCard label="LLM Saved" value={stats?.llm_calls_saved != null ? `${stats.llm_calls_saved}x` : "—"} sub="Calls avoided" accentColor="#10b981" icon="↯" /> */}
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-4">

        {/* ── Left ── */}
        <div>
          {/* Tabs + filters */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
              {(["shipments", "signals"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={cn("px-4 py-1.5 rounded-md text-[11px] uppercase tracking-widest transition-colors",
                    tab === t ? "bg-border text-primary" : "text-muted hover:text-subtle")}>
                  {t}{t === "signals" && signals.length > 0 ? ` (${signals.length})` : ""}
                </button>
              ))}
            </div>
            {tab === "shipments" && (
              <div className="flex gap-2">
                {["ALL", "HIGH", "MEDIUM", "LOW"].map(f => {
                  const c = f !== "ALL" ? getRiskConfig(f) : null;
                  return (
                    <button key={f} onClick={() => setFilter(f)}
                      className={cn("px-3 py-1 rounded-full text-[10px] tracking-widest border transition-all",
                        filter === f
                          ? (c ? cn(c.bg, c.border, c.text) : "bg-accent/10 border-accent text-accent")
                          : "bg-surface border-border text-muted hover:text-subtle"
                      )}>
                      {f}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Table */}
          {tab === "shipments" && (
            <Card>
              <div className="grid grid-cols-[100px_1fr_1fr_80px_110px_90px] px-5 py-2.5 border-b border-border text-[9px] text-muted uppercase tracking-widest">
                <span>ID</span><span>Vendor</span><span>Route</span><span>ETA</span><span>Status</span><span>Delay</span>
              </div>
              {filtered.length === 0
                ? <Empty message={shipments.length === 0 ? "No shipments loaded" : "No shipments match filter"} />
                : filtered.map((s: any) => {
                    const isSel = selected?.shipment_id === s.shipment_id;
                    return (
                      <div key={s.shipment_id}
                        onClick={() => setSelected(isSel ? null : s)}
                        className={cn("grid grid-cols-[100px_1fr_1fr_80px_110px_90px] px-5 py-3 border-b border-border/50 cursor-pointer transition-colors",
                          isSel ? "bg-white/[0.03]" : "hover:bg-white/[0.02]")}>
                        <span className="text-accent text-[12px]">{s.shipment_id}</span>
                        <span className="text-primary text-[12px]">{s.vendor}</span>
                        <span className="text-muted text-[11px]">{s.origin_city} → {s.dest_city}</span>
                        <span className="text-subtle text-[11px]">{s.eta?.slice(5) ?? "—"}</span>
                        <span>{s.risk_level ? <RiskBadge level={s.risk_level} /> : <span className="text-muted text-[10px]">Not analyzed</span>}</span>
                        <span className={cn("text-[12px]", s.delay_estimate && s.delay_estimate !== "None" ? "text-red-400" : "text-emerald-400")}>
                          {s.delay_estimate && s.delay_estimate !== "None" ? s.delay_estimate : "On time"}
                        </span>
                      </div>
                    );
                  })
              }
            </Card>
          )}

          {tab === "signals" && (
            <Card>
              {signals.length === 0
                ? <Empty message="Run analysis to fetch news signals" />
                : signals.map((sig: NewsSignal, i: number) => {
                    const c = getRiskConfig(sig.severity);
                    return (
                      <div key={i} className="px-5 py-3.5 border-b border-border/50">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={cn("text-[10px] font-semibold tracking-wide", c.text)}>{sig.risk_type}</span>
                          <span className="text-[10px] text-muted">{sig.published_at?.slice(0, 10)}</span>
                        </div>
                        <p className="text-[12px] text-primary mb-2">{sig.source_title}</p>
                        <div className="flex gap-2 flex-wrap">
                          <RiskBadge level={sig.severity} />
                          {sig.affected_routes?.slice(0, 2).map(r => (
                            <span key={r} className="text-[10px] text-muted bg-border/50 border border-border rounded px-2 py-0.5">{r}</span>
                          ))}
                          {sig.affected_ports?.slice(0, 2).map(p => (
                            <span key={p} className="text-[10px] text-muted bg-border/50 border border-border rounded px-2 py-0.5">{p}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })
              }
            </Card>
          )}

          {/* Detail drawer */}
          {selected && selected.risk_level && (
            <DetailDrawer
              report={selected}
              shipment={shipments.find(s => s.shipment_id === selected.shipment_id)}
              onClose={() => setSelected(null)}
            />
          )}
          {selected && !selected.risk_level && (
            <div className="mt-4 bg-surface border border-border rounded-xl px-5 py-8 text-center text-[12px] text-muted">
              Run analysis to see risk details for {selected.shipment_id}
            </div>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="flex flex-col gap-4">

          {/* Risk breakdown */}
          <Card>
            <CardHeader title="Risk Breakdown" right={`${enriched.length} affected`} />
            <div className="p-4">
              {enriched.length > 0 ? (
                <>
                  <RiskBar level="HIGH"   count={stats?.high_risk ?? 0}   total={enriched.length} />
                  <RiskBar level="MEDIUM" count={stats?.medium_risk ?? 0} total={enriched.length} />
                  <RiskBar level="LOW"    count={stats?.low_risk ?? 0}    total={enriched.length} />
                </>
              ) : <Empty message="Run analysis first" />}
            </div>
          </Card>

          {/* Top risks */}
          <Card>
            <CardHeader title="Top Risks" right={`${stats?.high_risk ?? 0} critical`} />
            {enriched.length === 0
              ? <Empty message="No risks detected yet" />
              : [...enriched]
                  .sort((a, b) => ["HIGH","MEDIUM","LOW"].indexOf(a.risk_level) - ["HIGH","MEDIUM","LOW"].indexOf(b.risk_level))
                  .slice(0, 5)
                  .map(r => {
                    const c = getRiskConfig(r.risk_level);
                    return (
                      <div key={r.shipment_id}
                        onClick={() => { setSelected(r); setTab("shipments"); setFilter("ALL"); }}
                        className="px-4 py-3 border-b border-border/50 cursor-pointer hover:bg-white/[0.02] transition-colors">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-accent text-[11px]">{r.shipment_id}</span>
                          <RiskBadge level={r.risk_level} />
                        </div>
                        <p className="text-[11px] text-subtle">{r.vendor}</p>
                        <p className={cn("text-[10px] mt-0.5", c.text)}>
                          {r.delay_estimate && r.delay_estimate !== "None" ? r.delay_estimate : "No delay"}
                        </p>
                      </div>
                    );
                  })
            }
          </Card>

          {/* Pipeline stats */}
          {/* <Card>
            <CardHeader title="Pipeline Stats" />
            <div className="p-4 flex flex-col gap-2">
              {stats ? (
                [
                  ["Articles fetched", stats.articles_fetched],
                  ["Signals extracted", stats.signals_extracted],
                  ["Affected shipments", stats.affected_shipments],
                  ["LLM calls used", stats.llm_calls_used],
                  ["LLM calls saved", stats.llm_calls_saved],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex justify-between text-[11px]">
                    <span className="text-muted">{label}</span>
                    <span className="text-primary">{val}</span>
                  </div>
                ))
              ) : <Empty message="Run analysis to see stats" />}
            </div>
          </Card> */}

        </div>
      </div>
    </div>
  );
}
