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
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
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
  if (t > 0.66) return "#15803d";
  if (t > 0.33) return "#e8734a";
  return "#dc2626";
}

export default function PerformancePage() {
  const t = useDashboardTheme();
  const { month } = useDashboardMonth();
  const [rows, setRows] = useState<ThemeRow[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<PerfPayload>(withMonthQuery("/api/performance/themes-top", month))
      .then((d) => {
        setRows((d.themes ?? []).slice(0, 15));
        setAsOf(d.as_of ?? "");
      })
      .catch((e: Error) => setErr(e.message));
  }, [month]);

  const hi = rows.length ? Math.max(...rows.map((r) => r.winIndex)) : 1;
  const lo = rows.length ? Math.min(...rows.map((r) => r.winIndex)) : 0;
  const chartData = [...rows].reverse();

  return (
    <div className="space-y-8">
      <section>
        <h2 className={t.pageTitle}>Client-facing performance</h2>
        <p className={t.pageSub}>
          {err
            ? `Theme slice unavailable (${err}). Check API connectivity.`
            : `Theme × cabinet × casino — AVG(WIN_Index) ranked (${asOf.slice(0, 10) || "latest period"}, top 15).`}
        </p>
      </section>

      <div className={t.panel}>
        <p className={t.panelLabel}>WIN index leaderboard (live rollup)</p>
        <div className="mt-4 h-[480px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} horizontal={false} />
              <XAxis type="number" stroke={t.chart.axis} domain={[0, "auto"]} />
              <YAxis type="category" dataKey="label" stroke={t.chart.axis} width={168} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
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
        <div className={t.calloutGreen}>
          <p className={t.calloutTitleGreen}>Convert themes</p>
          <p className={t.calloutBody}>
            Bottom quartile WIN index with stable coin-in — candidate for PAR/theme refresh before cabinet rip.
          </p>
        </div>
        <div className={t.calloutAmber}>
          <p className={t.calloutTitleAmber}>Hold & explain</p>
          <p className={t.calloutBody}>
            Pair index charts with plain-language RTP vs program edge so ops teams share one narrative with tribal councils.
          </p>
        </div>
        <div className={t.calloutSky}>
          <p className={t.calloutTitleSky}>Cabinet swaps</p>
          <p className={t.calloutBody}>
            When indexes lag peers on the same cabinet family, escalate hardware demo vs firmware-only fixes.
          </p>
        </div>
      </div>
    </div>
  );
}
