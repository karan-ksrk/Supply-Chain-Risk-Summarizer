"use client";
import { useEffect, useState } from "react";
import { api, type AnalysisResult, type RiskReport, type NewsSignal } from "@/lib/api";
import { getRiskConfig, formatDateTime, cn } from "@/lib/utils";
import { RiskBadge, Card, CardHeader, Spinner, Empty, Alert, Button } from "@/components/ui";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function ReportsPage() {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.getLatestReport()
      .then(setResult)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 flex justify-center pt-20"><Spinner size={24} /></div>;

  const stats = result?.stats;
  const reports = result?.risk_reports ?? [];
  const signals = result?.signals ?? [];

  const chartData = [
    { name: "HIGH",   count: stats?.high_risk ?? 0,   color: "#ef4444" },
    { name: "MEDIUM", count: stats?.medium_risk ?? 0, color: "#f59e0b" },
    { name: "LOW",    count: stats?.low_risk ?? 0,    color: "#10b981" },
  ];

  const llmData = [
    { name: "Used",  value: stats?.llm_calls_used ?? 0 },
    { name: "Saved", value: stats?.llm_calls_saved ?? 0 },
  ];

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-extrabold text-[22px] text-primary">Latest Report</h1>
          <p className="text-[12px] text-muted mt-0.5">
            {result ? `Generated ${formatDateTime(result.generated_at)} · Run #${result.run_id}` : "No report available"}
          </p>
        </div>
        {result && (
          <div className="text-[10px] text-muted bg-surface border border-border rounded-lg px-3 py-2">
            Run ID: <span className="text-accent">#{result.run_id}</span>
          </div>
        )}
      </div>

      {error && <Alert message={error} onClose={() => setError("")} />}

      {!result ? (
        <div className="bg-surface border border-border rounded-xl py-20 text-center">
          <p className="text-[14px] text-muted mb-2">No analysis report found</p>
          <p className="text-[12px] text-muted/60">Go to Dashboard and run an analysis first</p>
        </div>
      ) : (
        <>
          {/* Stats overview */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: "Shipments Checked", val: stats?.total_shipments, color: "#58a6ff" },
              { label: "Affected", val: stats?.affected_shipments, color: "#f59e0b" },
              { label: "Signals Found", val: stats?.signals_extracted, color: "#8b5cf6" },
              { label: "LLM Calls Saved", val: stats?.llm_calls_saved, color: "#10b981" },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-surface border border-border rounded-xl p-4">
                <p className="text-[10px] text-muted uppercase tracking-widest mb-1">{label}</p>
                <p className="font-display font-extrabold text-3xl" style={{ color }}>{val ?? "—"}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[1fr_260px] gap-4 mb-5">
            {/* Risk distribution chart */}
            <Card>
              <CardHeader title="Risk Distribution" />
              <div className="p-4 h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap="30%">
                    <XAxis dataKey="name" tick={{ fill: "#484f58", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#484f58", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, fontSize: 11, fontFamily: "IBM Plex Mono" }}
                      itemStyle={{ color: "#c9d1d9" }}
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* LLM efficiency */}
            <Card>
              <CardHeader title="LLM Efficiency" />
              <div className="p-4">
                <div className="h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={llmData} barCategoryGap="40%">
                      <XAxis dataKey="name" tick={{ fill: "#484f58", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#484f58", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, fontSize: 11 }} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        <Cell fill="#ef4444" />
                        <Cell fill="#10b981" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-muted text-center mt-2">
                  {stats?.llm_calls_saved ? `${Math.round((stats.llm_calls_saved / (stats.llm_calls_used + stats.llm_calls_saved)) * 100)}% calls eliminated` : ""}
                </p>
              </div>
            </Card>
          </div>

          {/* Risk Reports accordion */}
          <Card className="mb-5">
            <CardHeader title="Risk Reports" right={`${reports.length} shipments affected`} />
            {reports.length === 0
              ? <Empty message="No affected shipments in this run" />
              : [...reports]
                  .sort((a, b) => ["HIGH","MEDIUM","LOW"].indexOf(a.risk_level) - ["HIGH","MEDIUM","LOW"].indexOf(b.risk_level))
                  .map(r => {
                    const c = getRiskConfig(r.risk_level);
                    const open = expanded === r.shipment_id;
                    return (
                      <div key={r.shipment_id} className="border-b border-border/50">
                        <div
                          onClick={() => setExpanded(open ? null : r.shipment_id)}
                          className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-accent text-[12px] w-20">{r.shipment_id}</span>
                            <RiskBadge level={r.risk_level} />
                            <span className="text-subtle text-[12px]">{r.primary_risk}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {r.delay_estimate && r.delay_estimate !== "None" && (
                              <span className="text-red-400 text-[11px]">{r.delay_estimate}</span>
                            )}
                            <span className="text-muted text-[12px]">{open ? "▲" : "▼"}</span>
                          </div>
                        </div>
                        {open && (
                          <div className={cn("px-5 pb-4 animate-fade-in border-l-[3px] mx-5 mb-3 rounded-r-lg", c.border)} style={{ background: "#010409" }}>
                            <p className="text-[9px] text-muted uppercase tracking-widest mt-3 mb-2">Explanation</p>
                            <p className="text-[12px] text-subtle leading-relaxed mb-3">{r.explanation}</p>
                            <p className="text-[9px] text-muted uppercase tracking-widest mb-1">Action</p>
                            <p className="text-[12px] text-accent">{r.suggested_action}</p>
                          </div>
                        )}
                      </div>
                    );
                  })
            }
          </Card>

          {/* News signals */}
          <Card>
            <CardHeader title="News Signals Used" right={`${signals.length} total`} />
            {signals.length === 0
              ? <Empty message="No signals in this run" />
              : signals.map((sig: NewsSignal, i: number) => {
                  const c = getRiskConfig(sig.severity);
                  return (
                    <div key={i} className="px-5 py-3.5 border-b border-border/50">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[10px] font-semibold", c.text)}>{sig.risk_type}</span>
                          <RiskBadge level={sig.severity} />
                        </div>
                        <span className="text-[10px] text-muted">{sig.published_at?.slice(0, 10)} · {sig.source}</span>
                      </div>
                      <p className="text-[12px] text-primary mb-2">{sig.source_title}</p>
                      {sig.summary && <p className="text-[11px] text-subtle">{sig.summary}</p>}
                      <div className="flex gap-2 flex-wrap mt-2">
                        {[...sig.affected_routes ?? [], ...sig.affected_ports ?? []].slice(0, 4).map(tag => (
                          <span key={tag} className="text-[10px] text-muted bg-border/50 border border-border rounded px-2 py-0.5">{tag}</span>
                        ))}
                      </div>
                    </div>
                  );
                })
            }
          </Card>
        </>
      )}
    </div>
  );
}
