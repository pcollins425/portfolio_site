import { useEffect, useState } from "react";
import { fetchJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type MonthSeriesRow = {
  month: string;
  projects: { open: number; closed: number };
  deals: { created: number; won: number; closed: number };
  placements: { machines: number; delta: number };
  footprint: {
    changed: number;
    converts: number;
    swaps: number;
    active: number;
    pct: number;
  };
  leased_clients: number;
  reporting: { reported: number; expected: number; pct: number };
};

type ExecutivePayload = {
  source: string;
  error?: string;
  latest?: string;
  prev?: string;
  window_months?: number;
  series_source?: string;
  coinIn?: number;
  coinInMom?: number;
  actualWin?: number;
  actualMom?: number;
  commission?: number;
  commissionMom?: number;
  series?: MonthSeriesRow[];
};

function fmtMom(v: number) {
  return `MoM ${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function fmtDelta(n: number) {
  return `${n >= 0 ? "+" : ""}${n}`;
}

function fmtMonthLabel(iso: string) {
  if (!iso || iso.length < 7) return iso || "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

function Kpi({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  const t = useDashboardTheme();
  return (
    <div className={t.kpi}>
      <p className={t.kpiLabel}>{label}</p>
      <p className={t.kpiValue}>{value}</p>
      <p className={positive === false ? t.kpiSub : t.kpiSubPositive}>{sub}</p>
    </div>
  );
}

function MonthCard({ row }: { row: MonthSeriesRow }) {
  const t = useDashboardTheme();
  return (
    <article className={`rounded-xl border border-white/10 bg-[#141922] p-3 ${t.code}`}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#f3f5f9]">{fmtMonthLabel(row.month)}</h3>
        <span className="text-xs text-[#8b96a8]">
          {row.reporting.pct.toFixed(0)}% reporting ({row.reporting.reported}/
          {row.reporting.expected})
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-[#8b96a8]">Projects</dt>
          <dd className="font-mono text-[#c5cdd9]">
            {row.projects.open} open / {row.projects.closed} closed
          </dd>
        </div>
        <div>
          <dt className="text-[#8b96a8]">Deals</dt>
          <dd className="font-mono text-[#c5cdd9]">
            {row.deals.created} / {row.deals.won} / {row.deals.closed}
          </dd>
        </div>
        <div>
          <dt className="text-[#8b96a8]">Machines</dt>
          <dd className="font-mono text-[#c5cdd9]">
            {row.placements.machines.toLocaleString()} ({fmtDelta(row.placements.delta)})
          </dd>
        </div>
        <div>
          <dt className="text-[#8b96a8]">Footprint Δ</dt>
          <dd className="font-mono text-[#c5cdd9]">
            {row.footprint.pct.toFixed(2)}% ({row.footprint.converts}c+{row.footprint.swaps}s)
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[#8b96a8]">Leased clients</dt>
          <dd className="font-mono text-[#c5cdd9]">{row.leased_clients}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function ExecutivePage() {
  const t = useDashboardTheme();
  const { month } = useDashboardMonth();
  const [data, setData] = useState<ExecutivePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    fetchJson<ExecutivePayload>(withMonthQuery("/api/executive", month))
      .then((d) => {
        if (!dead) {
          setData(d);
          setErr(d.error ?? null);
        }
      })
      .catch((e: Error) => {
        if (!dead) setErr(e.message);
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [month]);

  const latest = data?.latest ?? "";
  const windowMonths = data?.window_months ?? 12;
  const coinIn = data?.coinIn ?? 0;
  const coinInMom = data?.coinInMom ?? 0;
  const actualWin = data?.actualWin ?? 0;
  const actualMom = data?.actualMom ?? 0;
  const commission = data?.commission ?? 0;
  const commissionMom = data?.commissionMom ?? 0;
  const series = [...(data?.series ?? [])].reverse(); // newest first for table

  return (
    <div className="space-y-6 md:space-y-8">
      <section>
        <h2 className={t.pageTitle}>Executive snapshot</h2>
        <p className={`${t.pageSub} hidden sm:block`}>
          {loading
            ? "Loading aggregates…"
            : err
              ? `Could not load live data (${err}). Check API connectivity and façade view.`
              : `Month-end ${latest}: revenue KPIs + trailing ${windowMonths}-month ops pulse (${data?.source ?? "live"}${data?.series_source ? ` · ops ${data.series_source}` : ""}). Machines = playable EOD floor roster. Project open = calendar still spanning month-end (IMS dates); most jobs are same-day.`}
        </p>
        <p className={`${t.pageSub} sm:hidden`}>
          {loading
            ? "Loading…"
            : err
              ? `Load failed (${err}).`
              : `${latest.slice(0, 7) || "—"} · ${windowMonths}mo ops${data?.series_source ? ` · ${data.series_source}` : ""}`}
        </p>
      </section>

      {!err && (
        <>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 sm:gap-4">
            <Kpi
              label="Coin-in"
              value={fmtUsd(coinIn)}
              sub={fmtMom(coinInMom)}
              positive={coinInMom >= 0}
            />
            <Kpi
              label="Actual win"
              value={fmtUsd(actualWin)}
              sub={fmtMom(actualMom)}
              positive={actualMom >= 0}
            />
            <Kpi
              label="Commission"
              value={fmtUsd(commission)}
              sub={fmtMom(commissionMom)}
              positive={commissionMom >= 0}
            />
          </div>

          <div className={t.panel}>
            <p className={t.panelLabel}>
              Ops pulse — trailing {windowMonths} months (newest first)
            </p>

            {/* Phone: stacked month cards */}
            <div className="mt-3 space-y-3 md:hidden">
              {series.map((row) => (
                <MonthCard key={row.month} row={row} />
              ))}
              {!series.length && !loading && (
                <p className={`${t.tableCellMuted} px-1 py-4`}>No series rows returned.</p>
              )}
            </div>

            {/* Tablet/desktop: scrollable wide table */}
            <div className="mt-4 hidden md:block">
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-[720px] w-full text-left text-sm">
                  <thead className={t.tableHead}>
                    <tr>
                      <th className="px-3 py-2.5 whitespace-nowrap">Month</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">Projects</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">Deals</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">Machines / Δ</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">Footprint Δ %</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">Clients</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">Reporting %</th>
                    </tr>
                  </thead>
                  <tbody className={t.tableRow}>
                    {series.map((row) => (
                      <tr key={row.month}>
                        <td className={t.tableCellName}>{fmtMonthLabel(row.month)}</td>
                        <td className={t.tableCell}>
                          {row.projects.open} / {row.projects.closed}
                        </td>
                        <td className={t.tableCell}>
                          {row.deals.created} / {row.deals.won} / {row.deals.closed}
                        </td>
                        <td className={t.tableCell}>
                          {row.placements.machines.toLocaleString()}
                          <span className="ml-1 text-xs opacity-70">
                            ({fmtDelta(row.placements.delta)})
                          </span>
                        </td>
                        <td className={t.tableCell}>
                          {row.footprint.pct.toFixed(2)}%
                          <span className="ml-1 text-xs opacity-70">
                            ({row.footprint.converts}c+{row.footprint.swaps}s /{" "}
                            {row.footprint.active.toLocaleString()})
                          </span>
                        </td>
                        <td className={t.tableCell}>{row.leased_clients}</td>
                        <td className={t.tableCell}>
                          {row.reporting.pct.toFixed(1)}%
                          <span className="ml-1 text-xs opacity-70">
                            ({row.reporting.reported}/{row.reporting.expected})
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!series.length && !loading && (
                      <tr>
                        <td className={t.tableCellMuted} colSpan={7}>
                          No series rows returned.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={`${t.calloutSky} hidden sm:block`}>
            <p className={t.calloutTitleSky}>Sources</p>
            <p className={t.calloutBody}>
              Revenue KPIs: Master_Revenue façade. Projects: <code className={t.code}>projects.ims</code>{" "}
              calendar window (open = start ≤ M &lt; end; closed = end in M — not eMaint Open status /
              undated rows). Deals: HubSpot landing — created in M / won / lost by{" "}
              <code className={t.code}>close_date</code>. Machines = playable SMM EOD floor roster. Footprint Δ =
              CONVERT + swaps ÷ machines. Clients = distinct casinos on that roster. Reporting = Finance
              billing coverage.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
