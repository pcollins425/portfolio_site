import { useEffect, useState } from "react";
import { fetchJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type MonthSeriesRow = {
  month: string;
  projects: { open: number; closed: number };
  deals: { open: number; won: number; closed: number };
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
    <div className="space-y-8">
      <section>
        <h2 className={t.pageTitle}>Executive snapshot</h2>
        <p className={t.pageSub}>
          {loading
            ? "Loading aggregates…"
            : err
              ? `Could not load live data (${err}). Check API connectivity and façade view.`
              : `Month-end ${latest}: revenue KPIs + trailing ${windowMonths}-month ops pulse (${data?.source ?? "live"}). Machines = playable EOD floor roster. Project open = calendar still spanning month-end (IMS dates); most jobs are same-day.`}
        </p>
      </section>

      {!err && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
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
            <div className={`mt-4 ${t.tableWrap} overflow-x-auto`}>
              <table className="min-w-full text-left text-sm">
                <thead className={t.tableHead}>
                  <tr>
                    <th className="px-4 py-3">Month</th>
                    <th className="px-4 py-3">Projects open / closed</th>
                    <th className="px-4 py-3">Deals open / won / lost</th>
                    <th className="px-4 py-3">Machines / Δ</th>
                    <th className="px-4 py-3">Footprint Δ %</th>
                    <th className="px-4 py-3">Leased clients</th>
                    <th className="px-4 py-3">Reporting %</th>
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
                        {row.deals.open} / {row.deals.won} / {row.deals.closed}
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

          <div className={t.calloutSky}>
            <p className={t.calloutTitleSky}>Sources</p>
            <p className={t.calloutBody}>
              Revenue KPIs: Master_Revenue façade. Projects: <code className={t.code}>projects.ims</code>{" "}
              calendar window (open = start ≤ M &lt; end; closed = end in M — not eMaint Open status /
              undated rows). Deals: HubSpot landing. Machines = playable SMM EOD floor roster. Footprint Δ =
              CONVERT + swaps ÷ machines. Clients = distinct casinos on that roster. Reporting = Finance
              billing coverage.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
