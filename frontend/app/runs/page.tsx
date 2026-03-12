"use client";
import { useEffect, useState } from "react";
import { api, type AnalysisRun } from "@/lib/api";
import { getRiskConfig, formatDateTime, cn } from "@/lib/utils";
import { Card, CardHeader, Spinner, Empty, Alert } from "@/components/ui";

export default function RunsPage() {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getRuns(50)
      .then(d => setRuns(d.runs))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const statusColors: Record<string, string> = {
    success:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/40",
    failed:     "text-red-400 bg-red-500/10 border-red-500/40",
    no_signals: "text-amber-400 bg-amber-500/10 border-amber-500/40",
    no_affected:"text-blue-400 bg-blue-500/10 border-blue-500/40",
    running:    "text-purple-400 bg-purple-500/10 border-purple-500/40",
  };

  const totalRuns     = runs.length;
  const successRuns   = runs.filter(r => r.status === "success").length;
  const totalSaved    = runs.reduce((acc, r) => acc + (r.llm_calls_saved ?? 0), 0);
  const avgHighRisk   = runs.length ? Math.round(runs.reduce((a, r) => a + r.high_risk, 0) / runs.length) : 0;

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-extrabold text-[22px] text-primary">Run History</h1>
        <p className="text-[12px] text-muted mt-0.5">Complete audit log of every pipeline execution</p>
      </div>

      {error && <Alert message={error} onClose={() => setError("")} />}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Total Runs",    val: totalRuns,   color: "#58a6ff" },
          { label: "Successful",    val: successRuns, color: "#10b981" },
          // { label: "LLM Calls Saved (total)", val: totalSaved, color: "#8b5cf6" },
          { label: "Avg High Risk / Run",     val: avgHighRisk, color: "#ef4444" },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-surface border border-border rounded-xl p-4">
            <p className="text-[10px] text-muted uppercase tracking-widest mb-1">{label}</p>
            <p className="font-display font-extrabold text-3xl" style={{ color }}>{val}</p>
          </div>
        ))}
      </div>

      <Card>
        <div className="grid grid-cols-[50px_1fr_120px_100px_70px_70px_80px_90px] px-5 py-2.5 border-b border-border text-[9px] text-muted uppercase tracking-widest">
          <span>#</span><span>Timestamp</span><span>Status</span><span>Provider</span>
          <span>HIGH</span><span>MED</span><span>Affected</span><span>LLM Saved</span>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Spinner size={20} /></div>
        ) : runs.length === 0 ? (
          <Empty message="No runs yet. Go to Dashboard and run an analysis." />
        ) : (
          runs.map(r => (
            <div key={r.id} className="grid grid-cols-[50px_1fr_120px_100px_70px_70px_80px_90px] px-5 py-3.5 border-b border-border/50 hover:bg-white/[0.02] transition-colors">
              <span className="text-accent text-[12px]">#{r.id}</span>
              <span className="text-subtle text-[12px]">{formatDateTime(r.run_at)}</span>
              <span>
                <span className={cn("text-[10px] px-2 py-0.5 rounded border", statusColors[r.status] ?? "text-muted border-border")}>
                  {r.status}
                </span>
              </span>
              <span className="text-[12px] text-subtle">{r.llm_provider?.toUpperCase()}{r.used_mock_news ? " (mock)" : ""}</span>
              <span className="text-red-400 text-[12px]">{r.high_risk}</span>
              <span className="text-amber-400 text-[12px]">{r.medium_risk}</span>
              <span className="text-subtle text-[12px]">{r.affected_shipments}</span>
              <span className="text-emerald-400 text-[12px]">{r.llm_calls_saved ?? "—"}</span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
