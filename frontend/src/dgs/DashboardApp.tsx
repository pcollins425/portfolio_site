import { useCallback, useEffect, useState } from "react";
import { apiUrl, fetchJson } from "../api/client";
import AnalystPage, { type AnalystSummary } from "../pages/AnalystPage";
import ExecutivePage from "../pages/ExecutivePage";
import FinancePage from "../pages/FinancePage";
import PerformancePage from "../pages/PerformancePage";
import { DashboardMonthProvider } from "./MonthContext";
import { useDashboardTheme } from "./ThemeContext";

export type DashboardRoute = "/executive" | "/analyst" | "/finance" | "/performance";

const ROUTES: DashboardRoute[] = ["/executive", "/analyst", "/finance", "/performance"];

function parseRoute(raw: string | null | undefined): DashboardRoute {
  const path = raw?.startsWith("/") ? raw : `/${raw || "executive"}`;
  return (ROUTES.includes(path as DashboardRoute) ? path : "/executive") as DashboardRoute;
}

function readInitialRoute(): DashboardRoute {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view) return parseRoute(view);
  return "/executive";
}

function readInitialMonth(): string {
  return new URLSearchParams(window.location.search).get("month")?.slice(0, 7) ?? "";
}

type Health = {
  ok: boolean;
  database?: string | null;
  host?: string | null;
  master_revenue_rows?: number | null;
};

type PeriodsPayload = { periods?: string[] };

function routePage(
  route: DashboardRoute,
  summary: AnalystSummary | null,
  onResolved: () => void,
) {
  switch (route) {
    case "/analyst":
      return <AnalystPage summary={summary} onResolved={onResolved} />;
    case "/finance":
      return <FinancePage />;
    case "/performance":
      return <PerformancePage />;
    default:
      return <ExecutivePage />;
  }
}

function MonthSelector({
  month,
  periods,
  onChange,
}: {
  month: string;
  periods: string[];
  onChange: (month: string) => void;
}) {
  const t = useDashboardTheme();
  if (!periods.length) return null;

  return (
    <label className={`inline-flex items-center gap-2 text-sm ${t.code}`}>
      <span className="font-medium">Period</span>
      <select
        value={month || periods[0]?.slice(0, 7) || ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-[#141922] px-2.5 py-1.5 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40"
      >
        {periods.map((p) => {
          const ym = p.slice(0, 7);
          return (
            <option key={p} value={ym}>
              {ym}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export default function DashboardApp() {
  const t = useDashboardTheme();
  const [route, setRoute] = useState<DashboardRoute>(readInitialRoute);
  const [month, setMonthState] = useState(readInitialMonth);
  const [periods, setPeriods] = useState<string[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [summary, setSummary] = useState<AnalystSummary | null>(null);

  const setMonth = (next: string) => {
    setMonthState(next);
    if (window.history.replaceState) {
      const u = new URL(window.location.href);
      if (next) u.searchParams.set("month", next);
      else u.searchParams.delete("month");
      window.history.replaceState({}, "", u.pathname + u.search);
    }
  };

  useEffect(() => {
    fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  useEffect(() => {
    fetch(apiUrl("/api/periods"))
      .then((r) => r.json())
      .then((d: PeriodsPayload) => {
        const list = d.periods ?? [];
        setPeriods(list);
        if (!month && list[0]) setMonthState(list[0].slice(0, 7));
      })
      .catch(() => setPeriods([]));
  }, []);

  const refreshSummary = useCallback((through: string) => {
    if (!through) return;
    fetchJson<AnalystSummary>(`/api/analyst/summary?through=${encodeURIComponent(through)}&months=12`)
      .then((d) => {
        setSummary(d);
        window.dispatchEvent(
          new CustomEvent("dgs-analyst-open-months", { detail: d.months_with_open }),
        );
      })
      .catch(() => {
        setSummary(null);
        window.dispatchEvent(new CustomEvent("dgs-analyst-open-months", { detail: 0 }));
      });
  }, []);

  useEffect(() => {
    const through = periods[0]?.slice(0, 7) || "";
    if (through) refreshSummary(through);
  }, [periods, refreshSummary]);

  useEffect(() => {
    const onRoute = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setRoute(parseRoute(detail));
    };
    window.addEventListener("dgs-dashboard-route", onRoute);
    return () => window.removeEventListener("dgs-dashboard-route", onRoute);
  }, []);

  return (
    <DashboardMonthProvider month={month} setMonth={setMonth} periods={periods}>
      <div className="dgs-dashboard-app space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {health?.ok === true ? (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
              Live · <span className="font-mono">{health.database ?? "?"}</span> @ {health.host ?? "?"}
              {health.master_revenue_rows != null
                ? ` · ${health.master_revenue_rows.toLocaleString()} façade rows`
                : null}
            </div>
          ) : health?.ok === false ? (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-sm text-rose-300">
              Database unreachable or API misconfigured. Set <code className="font-mono text-xs">?api=</code> on
              this page or run <code className="font-mono text-xs">backend_local</code> locally.
            </div>
          ) : (
            <div className={`text-xs ${t.code}`}>Connecting…</div>
          )}
          {route !== "/analyst" ? (
            <MonthSelector month={month} periods={periods} onChange={setMonth} />
          ) : null}
        </div>
        <div className="dgs-dashboard-panel">
          {routePage(route, summary, () => refreshSummary(periods[0]?.slice(0, 7) || ""))}
        </div>
      </div>
    </DashboardMonthProvider>
  );
}
