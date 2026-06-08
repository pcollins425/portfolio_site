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
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type TrendsPayload = {
  source: string;
  trends?: { month: string; actualWin: number; theoWin: number; variance: number }[];
};

type TrendRow = NonNullable<TrendsPayload["trends"]>[number];

export default function AnalystPage() {
  const t = useDashboardTheme();
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
        <h2 className={t.pageTitle}>Validity & jumps</h2>
        <p className={t.pageSub}>
          {err
            ? `Trends unavailable (${err}). Is the API reachable?`
            : empty
              ? "No trend rows returned — check dated rows in Master_Revenue façade."
              : "Portfolio-level actual vs theoretical win."}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={`${t.panel} lg:col-span-2`}>
          <p className={t.panelLabel}>Actual vs theoretical (national rollup)</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} />
                <XAxis dataKey="month" stroke={t.chart.axis} tick={{ fontSize: 11 }} />
                <YAxis stroke={t.chart.axis} tickFormatter={(v) => `${Math.round(v / 1e6)}M`} />
                <Tooltip
                  contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                  formatter={(value: number, name: string) => [fmtUsd(value), name]}
                />
                <Legend />
                <Line type="monotone" dataKey="actualWin" name="Actual win" stroke={t.chart.actualWin} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="theoWin" name="Theo win" stroke={t.chart.theoWin} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={t.panel}>
          <p className={t.panelLabel}>Theo variance %</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} />
                <XAxis dataKey="month" stroke={t.chart.axis} tick={{ fontSize: 10 }} angle={-35} textAnchor="end" height={56} />
                <YAxis stroke={t.chart.axis} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                  formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, "Variance"]}
                />
                <Bar dataKey="variance" fill={t.chart.variance} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <section className={t.panel}>
        <p className={t.panelLabel}>Analyst queue (rules placeholder)</p>
        <p className={`mt-3 text-sm ${t.code}`}>
          Automated anomaly flags can post here via <code className={t.code}>/api/analyst/sanity</code>; not wired yet.
        </p>
      </section>
    </div>
  );
}
