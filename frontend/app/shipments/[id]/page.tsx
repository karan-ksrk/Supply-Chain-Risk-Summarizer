"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type Shipment, type RiskReport } from "@/lib/api";
import { getRiskConfig, formatDate, cn } from "@/lib/utils";
import { RiskBadge, Card, CardHeader, Spinner, Empty } from "@/components/ui";

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [shipment, setShipment]   = useState<Shipment | null>(null);
  const [history, setHistory]     = useState<RiskReport[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    api.getShipment(id)
      .then(d => { setShipment(d.shipment); setHistory(d.risk_history); })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 flex justify-center pt-20"><Spinner size={24} /></div>;
  if (!shipment) return <div className="p-6 text-muted text-[13px]">Shipment not found.</div>;

  const latest = history[0];
  const c = latest ? getRiskConfig(latest.risk_level) : null;

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <button onClick={() => router.back()} className="text-muted text-[12px] hover:text-subtle mb-5 flex items-center gap-1.5">
        ← Back to Shipments
      </button>

      {/* Header */}
      <div className={cn("rounded-xl border p-5 mb-5", c ? cn(c.bg, c.border) : "bg-surface border-border")}>
        <div className="flex items-start justify-between">
          <div>
            <p className="font-display font-extrabold text-[20px] text-primary">{shipment.shipment_id}</p>
            <p className="text-[13px] text-subtle mt-0.5">{shipment.vendor}</p>
          </div>
          {latest && <RiskBadge level={latest.risk_level} />}
        </div>

        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label: "Origin", val: `${shipment.origin_city}, ${shipment.origin_country}` },
            { label: "Destination", val: `${shipment.dest_city}, ${shipment.dest_country}` },
            { label: "Carrier", val: shipment.carrier },
            { label: "Mode", val: shipment.transport_mode },
            { label: "Origin Port", val: shipment.origin_port },
            { label: "Dest Port", val: shipment.dest_port },
            { label: "ETA", val: shipment.eta },
            { label: "Freight Cost", val: shipment.freight_cost_usd ? `$${shipment.freight_cost_usd.toLocaleString()}` : "—" },
          ].map(({ label, val }) => (
            <div key={label} className="bg-canvas/60 rounded-lg p-3 border border-border">
              <p className="text-[9px] text-muted uppercase tracking-widest mb-1">{label}</p>
              <p className="text-[12px] text-primary">{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Latest AI analysis */}
      {latest && (
        <Card className="mb-5">
          <CardHeader title="Latest AI Risk Analysis" right={`Run #${history.length}`} />
          <div className="p-5">
            <div className={cn("rounded-lg p-4 mb-4 border-l-[3px]", c?.border)} style={{ background: "#010409" }}>
              <p className="text-[9px] text-muted tracking-widest uppercase mb-2">◈ Explanation</p>
              <p className="text-[12px] text-subtle leading-relaxed">{latest.explanation}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-canvas border border-border rounded-lg p-3">
                <p className="text-[9px] text-muted uppercase tracking-widest mb-1">Primary Risk</p>
                <p className="text-[12px] text-primary">{latest.primary_risk}</p>
              </div>
              <div className="bg-canvas border border-border rounded-lg p-3">
                <p className="text-[9px] text-muted uppercase tracking-widest mb-1">Suggested Action</p>
                <p className="text-[12px] text-accent">{latest.suggested_action}</p>
              </div>
            </div>
            <div className="flex gap-3">
              {[["Delay Estimate", latest.delay_estimate || "None"], ["Confidence", latest.confidence]].map(([l, v]) => (
                <div key={l} className="bg-canvas border border-border rounded-lg px-4 py-2.5">
                  <p className="text-[9px] text-muted uppercase tracking-widest mb-1">{l}</p>
                  <p className="text-[12px] text-primary">{v}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Risk history timeline */}
      <Card>
        <CardHeader title="Risk History" right={`${history.length} runs`} />
        {history.length === 0
          ? <Empty message="No risk history for this shipment yet" />
          : history.map((r, i) => {
              const rc = getRiskConfig(r.risk_level);
              return (
                <div key={i} className="flex gap-4 px-5 py-4 border-b border-border/50">
                  <div className="flex flex-col items-center">
                    <div className={cn("w-3 h-3 rounded-full mt-0.5 flex-shrink-0", rc.dot)} />
                    {i < history.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <RiskBadge level={r.risk_level} />
                      <span className="text-[11px] text-muted">{r.created_at ? formatDate(r.created_at as string) : "—"}</span>
                      {r.delay_estimate && r.delay_estimate !== "None" && (
                        <span className="text-[11px] text-red-400">{r.delay_estimate}</span>
                      )}
                    </div>
                    <p className="text-[12px] text-subtle">{r.primary_risk}</p>
                  </div>
                </div>
              );
            })
        }
      </Card>
    </div>
  );
}
