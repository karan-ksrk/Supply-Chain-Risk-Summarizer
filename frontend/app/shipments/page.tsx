"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Shipment, type RiskReport } from "@/lib/api";
import { getRiskConfig, formatDate, cn } from "@/lib/utils";
import { RiskBadge, Card, CardHeader, Spinner, Empty, Alert } from "@/components/ui";

export default function ShipmentsPage() {
  const router = useRouter();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [reports, setReports]     = useState<RiskReport[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [error, setError]         = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getShipments(),
      api.getLatestReport().catch(() => ({ risk_reports: [] })),
    ]).then(([sd, rd]) => {
      setShipments(sd.shipments);
      setReports(rd.risk_reports ?? []);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    const res = await api.uploadCsv(file);
    setUploading(false);
    if (res.status === "ok") {
      api.getShipments().then(d => setShipments(d.shipments));
    } else { setError(res.detail || "Upload failed"); }
    e.target.value = "";
  };

  const enriched = shipments.map(s => ({
    ...s,
    report: reports.find(r => r.shipment_id === s.shipment_id),
  }));

  const filtered = enriched.filter(s =>
    search === "" ||
    s.shipment_id.toLowerCase().includes(search.toLowerCase()) ||
    s.vendor.toLowerCase().includes(search.toLowerCase()) ||
    s.origin_city.toLowerCase().includes(search.toLowerCase()) ||
    s.dest_city.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-extrabold text-[22px] text-primary">Shipments</h1>
          <p className="text-[12px] text-muted mt-0.5">{shipments.length} records loaded</p>
        </div>
        <label className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] cursor-pointer bg-surface border border-border text-subtle hover:text-primary transition-colors", uploading && "opacity-50 pointer-events-none")}>
          {uploading ? <Spinner size={12} /> : "↑"} Upload CSV
          <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      {error && <Alert message={error} onClose={() => setError("")} />}

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total", value: shipments.length, color: "#58a6ff" },
          { label: "Sea Freight", value: shipments.filter(s => s.transport_mode === "Sea").length, color: "#1f6feb" },
          { label: "Air Freight", value: shipments.filter(s => s.transport_mode === "Air").length, color: "#8b5cf6" },
          { label: "Analyzed", value: reports.length, color: "#10b981" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-border rounded-xl p-4">
            <p className="text-[10px] text-muted uppercase tracking-widest mb-1">{label}</p>
            <p className="font-display font-extrabold text-3xl" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by ID, vendor, city..."
          className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-[12px] text-primary placeholder:text-muted outline-none focus:border-accent/50 transition-colors font-mono"
        />
      </div>

      {/* Table */}
      <Card>
        <div className="grid grid-cols-[100px_1fr_1fr_1fr_80px_100px_110px_100px] gap-4 px-5 py-2.5 border-b border-border text-[9px] text-muted uppercase tracking-widest">
          <span>ID</span><span>Vendor</span><span>Origin</span><span>Destination</span>
          <span>Mode</span><span>ETA</span><span>Risk Status</span><span>Delay</span>
        </div>
        {loading ? (
          <div className="py-12 flex justify-center"><Spinner size={20} /></div>
        ) : filtered.length === 0 ? (
          <Empty message="No shipments found" />
        ) : (
          filtered.map(({ report, ...s }) => {
            const c = report ? getRiskConfig(report.risk_level) : null;
            return (
              <div key={s.shipment_id}
                onClick={() => router.push(`/shipments/${s.shipment_id}`)}
                className="grid grid-cols-[100px_1fr_1fr_1fr_80px_100px_110px_100px] gap-4 px-5 py-3.5 border-b border-border/50 cursor-pointer hover:bg-white/[0.02] transition-colors group">
                <span className="text-accent text-[12px] group-hover:underline">{s.shipment_id}</span>
                <span className="text-primary text-[12px]">{s.vendor}</span>
                <div>
                  <p className="text-[12px] text-primary">{s.origin_city}</p>
                  <p className="text-[10px] text-muted">{s.origin_port}</p>
                </div>
                <div>
                  <p className="text-[12px] text-primary">{s.dest_city}</p>
                  <p className="text-[10px] text-muted">{s.dest_port}</p>
                </div>
                <span>
                  <span className={cn("text-[10px] px-2 py-0.5 rounded border",
                    s.transport_mode === "Air"
                      ? "text-violet-400 bg-violet-500/10 border-violet-500/40"
                      : "text-blue-400 bg-blue-500/10 border-blue-500/40"
                  )}>{s.transport_mode}</span>
                </span>
                <span className="text-subtle text-[12px]">{s.eta?.slice(5) ?? "—"}</span>
                <span>{report ? <RiskBadge level={report.risk_level} /> : <span className="text-muted text-[10px]">Pending</span>}</span>
                <span className={cn("text-[12px]",
                  report?.delay_estimate && report.delay_estimate !== "None"
                    ? "text-red-400" : "text-emerald-400"
                )}>
                  {report?.delay_estimate && report.delay_estimate !== "None" ? report.delay_estimate : "On time"}
                </span>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
