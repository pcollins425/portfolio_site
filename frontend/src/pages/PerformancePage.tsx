import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchJson } from "../api/client";
import { fmtUsd } from "../data/mockData";

type ThemeRow = {
  label: string;
  subtitle: string;
  winIndex: number;
  coinIn: number;
};

type PerfPayload = { themes?: ThemeRow[]; as_of?: string };

function palette(v: number, hi: number, lo: number): string {
  const t = (v - lo) / (hi - lo || 1);
  if (t > 0.66) return "#34d399";
  if (t > 0.33) return "#fbbf24";
  return "#f87171";
}

export default function PerformancePage() {
  const [rows, setRows] = useState<ThemeRow[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<PerfPayload>("/api/performance/themes-top")
      .then((d) => {
        setRows((d.themes ?? []).slice(0, 15));
        setAsOf(d.as_of ?? "");
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const hi = rows.length ? Math.max(...rows.map((r) => r.winIndex)) : 1;
  const lo = rows.length ? Math.min(...rows.map((r) => r.winIndex)) : 0;
  const chartData = [...rows].reverse();

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-white">Client-facing performance</h2>
        <p className="mt-1 text-sm text-slate-400">
          {err
            ? `Theme slice unavailable (${err}). Start backend_local (python run.py).`
            : `Theme × cabinet × casino — AVG(WIN_Index) ranked (${asOf.slice(0, 10) || "latest period"}, top 15).`}
        </p>
      </section>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          WIN index leaderboard (live rollup)
        </p>
        <div className="mt-4 h-[480px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" stroke="#94a3b8" domain={[0, "auto"]} />
              <YAxis type="category" dataKey="label" stroke="#94a3b8" width={168} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                formatter={(value: number) => [`${value}`, "WIN index"]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as ThemeRow | undefined;
                  if (!row?.subtitle && row?.coinIn == null) return "";
                  const bits = [row.subtitle, row.coinIn != null ? fmtUsd(row.coinIn) : ""].filter(Boolean);
                  return bits.join(" · ");
                }}
              />
              <Bar dataKey="winIndex" radius={[0, 6, 6, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={`${entry.label}-${i}`} fill={palette(entry.winIndex, hi, lo)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Convert themes</p>
          <p className="mt-2 text-sm text-slate-300">
            Bottom quartile WIN index with stable coin-in — candidate for PAR/theme refresh before cabinet rip.
          </p>
        </div>
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Hold & explain</p>
          <p className="mt-2 text-sm text-slate-300">
            Pair index charts with plain-language RTP vs program edge so ops teams share one narrative with tribal councils.
          </p>
        </div>
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-200">Cabinet swaps</p>
          <p className="mt-2 text-sm text-slate-300">
            When indexes lag peers on the same cabinet family, escalate hardware demo vs firmware-only fixes.
          </p>
        </div>
      </div>
    </div>
  );
}
