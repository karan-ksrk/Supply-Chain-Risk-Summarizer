"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type PaginatedShipmentsResponse, type RiskReport, type Shipment } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RiskBadge, Card, Spinner, Empty, Alert, PaginationControls } from "@/components/ui";

const PAGE_SIZE = 20;
const EMPTY_PAGE: PaginatedShipmentsResponse = {
  shipments: [],
  count: 0,
  total: 0,
  page: 1,
  page_size: PAGE_SIZE,
  total_pages: 0,
  summary: { total: 0, sea: 0, air: 0 },
};

export default function ShipmentsPage() {
  const router = useRouter();
  const [pageData, setPageData] = useState<PaginatedShipmentsResponse>(EMPTY_PAGE);
  const [reports, setReports] = useState<RiskReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api.getLatestReport()
      .then((data) => setReports(data.risk_reports ?? []))
      .catch(() => setReports([]));
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);

    api.getShipments({ page, pageSize: PAGE_SIZE, q: search, signal: abortController.signal })
      .then((data) => {
        setPageData(data);
        setError("");
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setPageData(EMPTY_PAGE);
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [page, search]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await api.uploadCsv(file);
    setUploading(false);
    if (res.status === "ok") {
      setPage(1);
      setLoading(true);
      api.getShipments({ page: 1, pageSize: PAGE_SIZE, q: search })
        .then((data) => {
          setPageData(data);
          setError("");
        })
        .catch((err) => setError(err.message || "Upload refresh failed"))
        .finally(() => setLoading(false));
    } else {
      setError(res.detail || "Upload failed");
    }
    e.target.value = "";
  };

  const shipments = pageData.shipments;
  const enriched = shipments.map((shipment: Shipment) => ({
    ...shipment,
    report: reports.find((report) => report.shipment_id === shipment.shipment_id),
  }));

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-extrabold text-[22px] text-primary">Shipments</h1>
          <p className="text-[12px] text-muted mt-0.5">{pageData.total} records loaded</p>
        </div>
        <label className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] cursor-pointer bg-surface border border-border text-subtle hover:text-primary transition-colors", uploading && "opacity-50 pointer-events-none")}>
          {uploading ? <Spinner size={12} /> : "↑"} Upload CSV
          <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      {error && <Alert message={error} onClose={() => setError("")} />}

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total", value: pageData.summary.total, color: "#58a6ff" },
          { label: "Sea Freight", value: pageData.summary.sea, color: "#1f6feb" },
          { label: "Air Freight", value: pageData.summary.air, color: "#8b5cf6" },
          { label: "Analyzed", value: reports.length, color: "#10b981" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-border rounded-xl p-4">
            <p className="text-[10px] text-muted uppercase tracking-widest mb-1">{label}</p>
            <p className="font-display font-extrabold text-3xl" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by ID, vendor, city..."
          className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-[12px] text-primary placeholder:text-muted outline-none focus:border-accent/50 transition-colors font-mono"
        />
      </div>

      <Card>
        <div className="grid grid-cols-[100px_1fr_1fr_1fr_80px_100px_110px_100px] gap-4 px-5 py-2.5 border-b border-border text-[9px] text-muted uppercase tracking-widest">
          <span>ID</span><span>Vendor</span><span>Origin</span><span>Destination</span>
          <span>Mode</span><span>ETA</span><span>Risk Status</span><span>Delay</span>
        </div>
        {loading ? (
          <div className="py-12 flex justify-center"><Spinner size={20} /></div>
        ) : enriched.length === 0 ? (
          <Empty message={search ? "No shipments found for this search" : "No shipments found"} />
        ) : (
          enriched.map(({ report, ...shipment }) => (
            <div
              key={shipment.shipment_id}
              onClick={() => router.push(`/shipments/${shipment.shipment_id}`)}
              className="grid grid-cols-[100px_1fr_1fr_1fr_80px_100px_110px_100px] gap-4 px-5 py-3.5 border-b border-border/50 cursor-pointer hover:bg-white/[0.02] transition-colors group"
            >
              <span className="text-accent text-[12px] group-hover:underline">{shipment.shipment_id}</span>
              <span className="text-primary text-[12px]">{shipment.vendor}</span>
              <div>
                <p className="text-[12px] text-primary">{shipment.origin_city}</p>
                <p className="text-[10px] text-muted">{shipment.origin_port}</p>
              </div>
              <div>
                <p className="text-[12px] text-primary">{shipment.dest_city}</p>
                <p className="text-[10px] text-muted">{shipment.dest_port}</p>
              </div>
              <span>
                <span className={cn("text-[10px] px-2 py-0.5 rounded border",
                  shipment.transport_mode === "Air"
                    ? "text-violet-400 bg-violet-500/10 border-violet-500/40"
                    : "text-blue-400 bg-blue-500/10 border-blue-500/40"
                )}>{shipment.transport_mode}</span>
              </span>
              <span className="text-subtle text-[12px]">{shipment.eta?.slice(5) ?? "—"}</span>
              <span>{report ? <RiskBadge level={report.risk_level} /> : <span className="text-muted text-[10px]">Pending</span>}</span>
              <span className={cn("text-[12px]",
                report?.delay_estimate && report.delay_estimate !== "None"
                  ? "text-red-400" : "text-emerald-400"
              )}>
                {report?.delay_estimate && report.delay_estimate !== "None" ? report.delay_estimate : "On time"}
              </span>
            </div>
          ))
        )}
        <PaginationControls
          page={pageData.page}
          totalPages={pageData.total_pages}
          totalItems={pageData.total}
          pageSize={pageData.page_size}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
