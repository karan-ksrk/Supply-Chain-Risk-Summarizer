// lib/utils.ts

export const RISK_CONFIG = {
  HIGH:   { bg: "bg-red-500/10",    border: "border-red-500",    text: "text-red-400",    dot: "bg-red-500",    bar: "#ef4444" },
  MEDIUM: { bg: "bg-amber-500/10",  border: "border-amber-500",  text: "text-amber-400",  dot: "bg-amber-500",  bar: "#f59e0b" },
  LOW:    { bg: "bg-emerald-500/10",border: "border-emerald-500",text: "text-emerald-400",dot: "bg-emerald-500",bar: "#10b981" },
} as const;

export type RiskLevel = keyof typeof RISK_CONFIG;

export function getRiskConfig(level?: string) {
  return RISK_CONFIG[(level as RiskLevel) ?? "LOW"] ?? RISK_CONFIG.LOW;
}

export function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}
