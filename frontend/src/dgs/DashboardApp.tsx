import { useEffect, useState } from "react";
import { apiUrl } from "../api/client";
import AnalystPage from "../pages/AnalystPage";
import ExecutivePage from "../pages/ExecutivePage";
import FinancePage from "../pages/FinancePage";
import PerformancePage from "../pages/PerformancePage";

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

type Health = {
  ok: boolean;
  database?: string | null;
  host?: string | null;
  master_revenue_rows?: number | null;
};

function routePage(route: DashboardRoute) {
  switch (route) {
    case "/analyst":
      return <AnalystPage />;
    case "/finance":
      return <FinancePage />;
    case "/performance":
      return <PerformancePage />;
    default:
      return <ExecutivePage />;
  }
}

export default function DashboardApp() {
  const [route, setRoute] = useState<DashboardRoute>(readInitialRoute);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  useEffect(() => {
    const onRoute = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setRoute(parseRoute(detail));
    };
    window.addEventListener("dgs-dashboard-route", onRoute);
    return () => window.removeEventListener("dgs-dashboard-route", onRoute);
  }, []);

  return (
    <div className="dgs-dashboard-app space-y-4">
      {health?.ok === false && (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">
          Database unreachable or API misconfigured. Set <code className="font-mono text-xs">?api=</code> on
          this page or run <code className="font-mono text-xs">backend_local</code> locally.
        </div>
      )}
      {health?.ok === true && (
        <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-2 text-xs text-[#166534]">
          Live · <span className="font-mono">{health.database ?? "?"}</span> @ {health.host ?? "?"}
          {health.master_revenue_rows != null
            ? ` · ${health.master_revenue_rows.toLocaleString()} façade rows`
            : null}
        </div>
      )}
      <div className="dgs-dashboard-panel">{routePage(route)}</div>
    </div>
  );
}
