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
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm text-emerald-400/90">{sub}</p>
    </div>
  );
}

export default function ExecutivePage() {
  const [data, setData] = useState<ExecutivePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    fetchJson<ExecutivePayload>("/api/executive")
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
  }, []);

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
        <h2 className="text-lg font-semibold text-white">Executive snapshot</h2>
        <p className="mt-1 text-sm text-slate-400">
          {loading
            ? "Loading aggregates from Master_Revenue…"
            : err
              ? `Could not load live data (${err}). From backend_local run python run.py with MSSQL_* and façade view configured.`
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
            />
            <Kpi
              label="Actual win"
              value={fmtUsd(actualWin)}
              sub={`MoM ${actualMom >= 0 ? "+" : ""}${(actualMom * 100).toFixed(1)}%`}
            />
            <Kpi
              label="Commission"
              value={fmtUsd(commission)}
              sub={`MoM ${commissionMom >= 0 ? "+" : ""}${(commissionMom * 100).toFixed(1)}%`}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Commission by casino ({latest || "latest period"})
            </p>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="casino" stroke="#94a3b8" width={96} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                    formatter={(value: number, name: string) =>
                      [
                        fmtUsd(value),
                        name === "commission" ? "Commission" : "Actual win",
                      ]
                    }
                  />
                  <Bar dataKey="commission" fill="#34d399" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
