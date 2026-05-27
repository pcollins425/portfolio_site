import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchJson } from "../api/client";
import { fmtUsd } from "../data/mockData";

type TrendsPayload = {
  source: string;
  trends?: { month: string; actualWin: number; theoWin: number; variance: number }[];
};

type TrendRow = NonNullable<TrendsPayload["trends"]>[number];

export default function AnalystPage() {
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<TrendsPayload>("/api/analyst/trends")
      .then((d) => setTrend(d.trends ?? []))
      .catch((e: Error) => setErr(e.message));
  }, []);

  const empty = trend.length === 0;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-white">Validity & jumps</h2>
        <p className="mt-1 text-sm text-slate-400">
          {err
            ? `Trends unavailable (${err}). Is backend_local running (python run.py)?`
            : empty
              ? "No trend rows returned — check dated rows in Master_Revenue façade."
              : "Portfolio-level actual vs theoretical win."}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Actual vs theoretical (national rollup)
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis stroke="#94a3b8" tickFormatter={(v) => `${Math.round(v / 1e6)}M`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                  formatter={(value: number, name: string) => [fmtUsd(value), name]}
                />
                <Legend />
                <Line type="monotone" dataKey="actualWin" name="Actual win" stroke="#34d399" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="theoWin" name="Theo win" stroke="#818cf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Theo variance %
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" height={56} />
                <YAxis stroke="#94a3b8" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                  formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, "Variance"]}
                />
                <Bar dataKey="variance" fill="#fbbf24" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Analyst queue (rules placeholder)
        </p>
        <p className="mt-3 text-sm text-slate-500">
          Automated anomaly flags can post here via <code className="text-slate-400">/api/analyst/sanity</code>; not wired yet.
        </p>
        <ul className="mt-4 divide-y divide-slate-800" />
      </section>
    </div>
  );
}
