"use client";
// components/ui/index.tsx — all reusable UI primitives

import { getRiskConfig, cn, type RiskLevel } from "@/lib/utils";

// ── Badge ─────────────────────────────────────────────────────────────────────
export function RiskBadge({ level }: { level?: string }) {
  const c = getRiskConfig(level);
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border", c.bg, c.border, c.text)}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", c.dot)} />
      {level ?? "—"}
    </span>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
export function StatCard({
  label, value, sub, accentColor, icon,
}: {
  label: string; value?: string | number; sub?: string;
  accentColor: string; icon?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5 relative overflow-hidden">
      <div className="absolute left-0 inset-y-0 w-[3px] rounded-l-xl" style={{ background: accentColor }} />
      <div className="pl-3">
        <p className="text-[10px] text-muted uppercase tracking-widest mb-2">{label}</p>
        <div className="flex items-end gap-2">
          <span className="font-display text-4xl font-extrabold leading-none" style={{ color: accentColor }}>
            {value ?? "—"}
          </span>
          {icon && <span className="text-xl mb-0.5 opacity-30">{icon}</span>}
        </div>
        {sub && <p className="text-[11px] text-muted mt-1.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────
export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-display font-bold text-[14px] text-primary">{title}</h2>
      {right}
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-surface border border-border rounded-xl overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
      <span className="font-display font-bold text-[13px] text-primary">{title}</span>
      {right && <div className="text-[11px] text-muted">{right}</div>}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
export function Button({
  children, onClick, disabled, variant = "primary", className,
}: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "primary" | "ghost" | "danger"; className?: string;
}) {
  const base = "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-mono tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary: "text-white border border-emerald-600 disabled:pointer-events-none",
    ghost:   "bg-surface border border-border text-subtle hover:text-primary hover:border-muted",
    danger:  "bg-red-500/10 border border-red-500/40 text-red-400 hover:bg-red-500/20",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={variant === "primary" ? { background: "linear-gradient(135deg,#238636,#1a7f37)" } : undefined}
      className={cn(base, variants[variant], className)}
    >
      {children}
    </button>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size, borderWidth: 2 }}
      className="inline-block rounded-full border-muted border-t-accent animate-spin"
    />
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function Empty({ message }: { message: string }) {
  return (
    <div className="py-12 text-center text-[12px] text-muted">{message}</div>
  );
}

// ── Risk bar ──────────────────────────────────────────────────────────────────
export function RiskBar({ level, count, total }: { level: RiskLevel; count: number; total: number }) {
  const c = getRiskConfig(level);
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-[11px] mb-1.5">
        <span className={c.text}>{level}</span>
        <span className="text-muted">{count} shipments</span>
      </div>
      <div className="h-1 bg-border rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: c.bar }} />
      </div>
    </div>
  );
}


export function PaginationControls({
  page, totalPages, totalItems, pageSize, onPageChange,
}: {
  page: number; totalPages: number; totalItems: number; pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
      <span className="text-[11px] text-muted">Showing {start}-{end} of {totalItems}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg text-[11px] border border-border text-subtle hover:text-primary disabled:opacity-40 disabled:pointer-events-none"
        >
          Prev
        </button>
        <span className="text-[11px] text-muted">Page {page} / {totalPages}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 rounded-lg text-[11px] border border-border text-subtle hover:text-primary disabled:opacity-40 disabled:pointer-events-none"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ── Alert banner ──────────────────────────────────────────────────────────────
export function Alert({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 bg-red-500/10 border border-red-500/40 rounded-lg px-4 py-3 mb-5 text-[12px] text-red-400 animate-fade-in">
      <span>⚠ {message}</span>
      {onClose && <button onClick={onClose} className="text-red-400 hover:text-red-300 flex-shrink-0">✕</button>}
    </div>
  );
}
