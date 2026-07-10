import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type ExecutivePayload = {
  source: string;
  error?: string;
  latest?: string;
  prev?: string;
  coinIn?: number;
  coinInMom?: number;
  actualWin?: number;
  actualMom?: number;
  commission?: number;
  commissionMom?: number;
  bars?: { casino: string; commission: number; actual_win: number }[];
};

function normalizeBars(rows: ExecutivePayload["bars"]) {
  if (!rows?.length) return [];
  return rows.map((r) => ({
    casino: r.casino,
    commission: Number(r.commission),
    actual_win: Number(r.actual_win),
  }));
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

  const bars =
    normalizeBars(data?.bars) ||
    ([] as { casino: string; commission: number; actual_win: number }[]);

  const latest = data?.latest ?? "";
  const coinIn = data?.coinIn ?? 0;
  const coinInMom = data?.coinInMom ?? 0;
  const actualWin = data?.actualWin ?? 0;
  const actualMom = data?.actualMom ?? 0;
  const commission = data?.commission ?? 0;
  const commissionMom = data?.commissionMom ?? 0;

  return (
    <div className="space-y-8">
      <section>
        <h2 className={t.pageTitle}>Executive snapshot</h2>
        <p className={t.pageSub}>
          {loading
            ? "Loading aggregates from Master_Revenue…"
            : err
              ? `Could not load live data (${err}). Check API connectivity and façade view.`
              : `Month-end ${latest}: national totals (${data?.source ?? "live"})`}
        </p>
      </section>

      {!err && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi
              label="Coin-in"
              value={fmtUsd(coinIn)}
              sub={`MoM ${coinInMom >= 0 ? "+" : ""}${(coinInMom * 100).toFixed(1)}%`}
              positive={coinInMom >= 0}
            />
            <Kpi
              label="Actual win"
              value={fmtUsd(actualWin)}
              sub={`MoM ${actualMom >= 0 ? "+" : ""}${(actualMom * 100).toFixed(1)}%`}
              positive={actualMom >= 0}
            />
            <Kpi
              label="Commission"
              value={fmtUsd(commission)}
              sub={`MoM ${commissionMom >= 0 ? "+" : ""}${(commissionMom * 100).toFixed(1)}%`}
              positive={commissionMom >= 0}
            />
          </div>

          <div className={t.panel}>
            <p className={t.panelLabel}>Commission by casino ({latest || "latest period"})</p>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} horizontal={false} />
                  <XAxis type="number" stroke={t.chart.axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="casino" stroke={t.chart.axis} width={140} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                    formatter={(value: number, name: string) =>
                      [fmtUsd(value), name === "commission" ? "Commission" : "Actual win"]
                    }
                  />
                  <Bar dataKey="commission" fill={t.chart.commission} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
