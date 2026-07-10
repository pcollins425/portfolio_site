import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { fetchJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";

type CasinoRow = {
  casino: string;
  avgAdw: number;
  houseWpu: number;
  delta: number;
};

type CasinosPayload = { casinos: CasinoRow[]; as_of?: string };
type RatioRow = { month: string; ratio: number | null };
type RatioPayload = { ratios: RatioRow[] };

export default function FinancePage() {
  const t = useDashboardTheme();
  const { month } = useDashboardMonth();
  const [scatter, setScatter] = useState<CasinoRow[]>([]);
  const [ratios, setRatios] = useState<RatioRow[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJson<CasinosPayload>(withMonthQuery("/api/finance/casinos-latest", month)),
      fetchJson<RatioPayload>("/api/finance/commission-intensity"),
    ])
      .then(([c, r]) => {
        setScatter(c.casinos ?? []);
        setAsOf(c.as_of ?? "");
        const clean = (r.ratios ?? []).filter((x) => typeof x.ratio === "number") as Array<{
          month: string;
          ratio: number;
        }>;
        setRatios(clean);
      })
      .catch((e: Error) => setErr(e.message));
  }, [month]);

  return (
    <div className="space-y-8">
      <section>
        <h2 className={t.pageTitle}>Economics & viability</h2>
        <p className={t.pageSub}>
          {err
            ? `Live slice unavailable (${err}). Check API connectivity.`
            : `Average daily actual vs house benchmark. Commission÷actual (${asOf.replace(/T.+/, "") || "latest month"} slice).`}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={t.panel}>
          <p className={t.panelLabel}>ADW vs house benchmark ({asOf.slice(0, 10) || "—"})</p>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} />
                <XAxis type="number" dataKey="houseWpu" name="House benchmark" stroke={t.chart.axis} domain={["dataMin - 10", "dataMax + 10"]} />
                <YAxis type="number" dataKey="avgAdw" name="Avg ADW" stroke={t.chart.axis} />
                <ZAxis range={[80, 80]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                  formatter={(value: unknown, name: string) =>
                    [typeof value === "number" ? Math.round(value) : String(value), name]
                  }
                  labelFormatter={(_, payload) =>
                    payload?.length ? String((payload[0] as { payload?: { casino?: string } }).payload?.casino ?? "") : ""
                  }
                />
                <Scatter name="Casinos" data={scatter} fill={t.chart.scatter} shape="circle" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className={`mt-2 text-xs ${t.code}`}>
            Interpret with commission profile mix — aggregates are AVG(ADW)/AVG(HouseWPU) by casino row grain.
          </p>
        </div>

        <div className={t.panel}>
          <p className={t.panelLabel}>Commission ÷ actual win (national)</p>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ratios}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} />
                <XAxis dataKey="month" stroke={t.chart.axis} tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={52} />
                <YAxis stroke={t.chart.axis} domain={[0, "auto"]} tickFormatter={(v) => `${(v * 100).toFixed(0)}¢/$`} />
                <Tooltip
                  contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                  formatter={(value: number) => [`${(value * 100).toFixed(1)}¢ per $ actual`, "Ratio"]}
                />
                <Legend />
                <Line type="stepAfter" dataKey="ratio" name="Commission intensity" stroke={t.chart.ratio} strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className={t.tableWrap}>
        <table className="w-full text-left text-sm">
          <thead className={t.tableHead}>
            <tr>
              <th className="px-4 py-3 font-medium">Casino</th>
              <th className="px-4 py-3 font-medium">Avg ADW</th>
              <th className="px-4 py-3 font-medium">House benchmark</th>
              <th className="px-4 py-3 font-medium">Gap</th>
            </tr>
          </thead>
          <tbody className={t.tableRow}>
            {scatter.map((r) => (
              <tr key={r.casino + r.avgAdw} className={r.delta < 0 ? t.tableRowBad : ""}>
                <td className={t.tableCellName}>{r.casino}</td>
                <td className={t.tableCell}>${r.avgAdw}</td>
                <td className={t.tableCellMuted}>${r.houseWpu}</td>
                <td className={`px-4 py-3 font-mono ${r.delta >= 0 ? t.tableCellGood : t.tableCellBad}`}>
                  {r.delta >= 0 ? "+" : ""}
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
