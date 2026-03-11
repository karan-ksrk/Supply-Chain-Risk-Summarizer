"use client";
import "./globals.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const NAV = [
  { href: "/",         label: "Dashboard",  icon: "◈" },
  { href: "/shipments",label: "Shipments",  icon: "◫" },
  { href: "/reports",  label: "Reports",    icon: "⊞" },
  { href: "/runs",     label: "Run History",icon: "⊕" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [health, setHealth] = useState<{ status: string; llm_provider: string } | null>(null);

  useEffect(() => {
    api.health()
      .then(setHealth)
      .catch(() => setHealth({ status: "offline", llm_provider: "—" }));
  }, []);

  const online = health?.status === "ok";

  return (
    <html lang="en">
      <head>
        <title>Nexus Risk — Supply Chain Intelligence</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="flex h-screen overflow-hidden">

        {/* ── Sidebar ── */}
        <aside className="w-56 flex-shrink-0 bg-surface border-r border-border flex flex-col">
          {/* Logo */}
          <div className="h-14 flex items-center gap-3 px-5 border-b border-border">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
              style={{ background: "linear-gradient(135deg,#238636,#1f6feb)" }}>◈</div>
            <span className="font-display font-extrabold text-[15px] text-primary tracking-tight">NEXUS</span>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-4 px-3 flex flex-col gap-1">
            {NAV.map(({ href, label, icon }) => {
              const active = path === href;
              return (
                <Link key={href} href={href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] transition-colors
                    ${active
                      ? "bg-accent/10 text-accent border border-accent/20"
                      : "text-muted hover:text-subtle hover:bg-white/[0.03]"
                    }`}>
                  <span className={active ? "text-accent" : ""}>{icon}</span>
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Server status */}
          <div className="p-4 border-t border-border">
            <div className="bg-canvas rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 animate-blink
                  ${online ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="text-[10px] text-muted uppercase tracking-widest">
                  {online ? "Connected" : "Offline"}
                </span>
              </div>
              <div className="text-[11px] text-subtle mt-1">
                {health?.llm_provider ? `LLM: ${health.llm_provider.toUpperCase()}` : "Starting..."}
              </div>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-auto bg-canvas">
          {children}
        </main>

      </body>
    </html>
  );
}
