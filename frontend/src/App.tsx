import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { apiUrl } from "./api/client";
import AnalystPage from "./pages/AnalystPage";
import ExecutivePage from "./pages/ExecutivePage";
import FinancePage from "./pages/FinancePage";
import PerformancePage from "./pages/PerformancePage";

const nav = [
  { to: "/executive", label: "Executive" },
  { to: "/analyst", label: "Analyst" },
  { to: "/finance", label: "Finance" },
  { to: "/performance", label: "Performance" },
];

type Health = {
  ok: boolean;
  database?: string | null;
  host?: string | null;
  master_revenue_rows?: number | null;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {health?.ok === false && (
        <div className="border-b border-amber-900/70 bg-amber-950/50 px-4 py-3 text-center text-sm text-amber-100">
          Database unreachable, façade missing, or API URL misconfigured. **Dev:** set <code className="text-amber-200">MSSQL_*</code>{' '}
          in <code className="text-amber-200">backend_local/.env</code>, run <code className="text-amber-200">python run.py</code>{' '}
          and <code className="text-amber-200">npm run dev</code> together. **Hosted:** build with{' '}
          <code className="text-amber-200">VITE_API_BASE_URL</code> pointing at your tunnel API (no trailing slash),
          e.g. <code className="text-amber-200">https://api.collinsmediallc.com</code>.
        </div>
      )}
      {health?.ok === true && (
        <div className="border-b border-emerald-900/60 bg-emerald-950/30 px-4 py-2 text-center text-xs text-emerald-200/90">
          Live · <span className="font-mono">{health.database ?? "?"}</span> @ {health.host ?? "?"}
          {health.master_revenue_rows != null
            ? ` · Master_Revenue façade ${health.master_revenue_rows.toLocaleString()} rows`
            : null}
        </div>
      )}

      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-emerald-400/90">Master Revenue</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">Portfolio dashboards</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-400">
              Charts read{' '}
              <span className="text-slate-300">
                [<code className="font-mono text-xs">dashboard</code>].[<code className="font-mono text-xs">vw_performance_report</code>]
              </span>{' '}
              through FastAPI. **Dev:** this Vite server proxies <code className="font-mono text-slate-500">/api</code> →{' '}
              <code className="font-mono text-slate-500">localhost:9002</code>. **Prod:**{' '}
              <code className="font-mono text-slate-500">VITE_API_BASE_URL</code> (+ <code className="font-mono text-slate-500">/api/...</code>
              ).
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {nav.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  [
                    "rounded-lg px-3 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white",
                  ].join(" ")
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/executive" replace />} />
          <Route path="/executive" element={<ExecutivePage />} />
          <Route path="/analyst" element={<AnalystPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/performance" element={<PerformancePage />} />
        </Routes>
      </main>
    </div>
  );
}
