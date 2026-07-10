import { useEffect, useMemo, useState } from "react";
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
import { useDashboardMonth } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type MonthlyRow = {
  month: string;
  expected_entries: number;
  invoiced_entries: number;
  invoiced_keys: number;
  uninvoiced_keys: number;
  unexpected_keys: number;
  commission: number;
  casinos_expected: number;
  casinos_reported: number;
  casinos_missing: number;
};

type CasinoRow = {
  casino: string;
  expected_entries: number;
  invoiced_entries: number;
  invoiced_keys: number;
  uninvoiced_keys: number;
  unexpected_keys: number;
  gap: number;
  commission: number;
  last_report: string | null;
  missing_months: string[];
};

type OverviewPayload = {
  source: string;
  from: string;
  to: string;
  months: string[];
  kpis: MonthlyRow & {
    expected_entries_mom: number;
    expected_entries_yoy: number;
    commission_mom: number;
    commission_yoy: number;
    mom_month: string;
    yoy_month: string;
  };
  monthly: MonthlyRow[];
  casinos: CasinoRow[];
};

const SELECT_CLS =
  "rounded-lg border border-white/10 bg-[#141922] px-2.5 py-1.5 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40";

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function Kpi({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  const t = useDashboardTheme();
  return (
    <div className={t.kpi}>
      <p className={t.kpiLabel}>{label}</p>
      <p className={t.kpiValue}>{value}</p>
      {sub != null && <p className={positive === false ? t.kpiSub : t.kpiSubPositive}>{sub}</p>}
    </div>
  );
}

export default function FinancePage() {
  const t = useDashboardTheme();
  const { periods } = useDashboardMonth();
  const monthOptions = useMemo(
    () => Array.from(new Set(periods.map((p) => p.slice(0, 7)))),
    [periods],
  );

  const [fromM, setFromM] = useState("");
  const [toM, setToM] = useState("");
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!monthOptions.length || toM) return;
    setToM(monthOptions[0]);
    setFromM(monthOptions[Math.min(5, monthOptions.length - 1)]);
  }, [monthOptions, toM]);

  useEffect(() => {
    if (!fromM || !toM) return;
    let dead = false;
    setLoading(true);
    fetchJson<OverviewPayload>(
      `/api/finance/overview?from=${encodeURIComponent(fromM)}&to=${encodeURIComponent(toM)}`,
    )
      .then((d) => {
        if (!dead) {
          setData(d);
          setErr(null);
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
  }, [fromM, toM]);

  const setFrom = (v: string) => {
    setFromM(v);
    if (v > toM) setToM(v);
  };
  const setTo = (v: string) => {
    setToM(v);
    if (v < fromM) setFromM(v);
  };

  const k = data?.kpis;
  const chartData = (data?.monthly ?? []).map((m) => ({
    month: m.month,
    commission: m.commission,
    expected: m.expected_entries,
    entries: m.invoiced_entries,
  }));

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className={t.pageTitle}>Billing coverage</h2>
          <p className={t.pageSub}>
            {err
              ? `Overview unavailable (${err}). Check API connectivity.`
              : loading
                ? "Loading billing coverage…"
                : `Processing months ${data?.from ?? "—"} → ${data?.to ?? "—"} · expected = SMM rows live (golive001, else install) in month · invoiced = MR entries with slot_master_id.`}
          </p>
        </div>
        <div className={`flex items-center gap-2 text-sm ${t.code}`}>
          <span className="font-medium">From</span>
          <select value={fromM} onChange={(e) => setFrom(e.target.value)} className={SELECT_CLS}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="font-medium">To</span>
          <select value={toM} onChange={(e) => setTo(e.target.value)} className={SELECT_CLS}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </section>

      {k && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label={`Expected vs invoiced (${k.month})`}
            value={`${k.expected_entries.toLocaleString()} / ${k.invoiced_entries.toLocaleString()}`}
            sub={`${k.uninvoiced_keys} uninvoiced · ${k.unexpected_keys} unexpected SMM keys`}
            positive={k.invoiced_entries >= k.expected_entries && k.uninvoiced_keys === 0}
          />
          <Kpi
            label="Expected entries (SMM)"
            value={k.expected_entries.toLocaleString()}
            sub={`MoM ${fmtPct(k.expected_entries_mom)} · YoY ${fmtPct(k.expected_entries_yoy)}`}
            positive={k.expected_entries_mom >= 0}
          />
          <Kpi
            label={`Commission (${k.month})`}
            value={fmtUsd(k.commission)}
            sub={`MoM ${fmtPct(k.commission_mom)} · YoY ${fmtPct(k.commission_yoy)}`}
            positive={k.commission_mom >= 0}
          />
          <Kpi
            label="Casinos missing report"
            value={`${k.casinos_missing}`}
            sub={`${k.casinos_reported} of ${k.casinos_expected} expected reported`}
            positive={k.casinos_missing === 0}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={t.panel}>
          <p className={t.panelLabel}>Commission by month</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} />
                <XAxis dataKey="month" stroke={t.chart.axis} tick={{ fontSize: 11 }} />
                <YAxis stroke={t.chart.axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                  formatter={(value: number) => [fmtUsd(value), "Commission"]}
                />
                <Bar dataKey="commission" fill={t.chart.commission} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={t.panel}>
          <p className={t.panelLabel}>Expected vs invoiced entries (SMM keys)</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} />
                <XAxis dataKey="month" stroke={t.chart.axis} tick={{ fontSize: 11 }} />
                <YAxis stroke={t.chart.axis} />
                <Tooltip
                  contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                />
                <Legend />
                <Line type="monotone" dataKey="expected" name="Expected entries" stroke={t.chart.theoWin} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="entries" name="Invoiced entries" stroke={t.chart.actualWin} strokeWidth={2} dot={false} />
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
              <th className="px-4 py-3 font-medium">Expected</th>
              <th className="px-4 py-3 font-medium">Invoiced</th>
              <th className="px-4 py-3 font-medium">Uninvoiced</th>
              <th className="px-4 py-3 font-medium">Unexpected</th>
              <th className="px-4 py-3 font-medium">Gap</th>
              <th className="px-4 py-3 font-medium">Last report</th>
              <th className="px-4 py-3 font-medium">Missing in range</th>
            </tr>
          </thead>
          <tbody className={t.tableRow}>
            {(data?.casinos ?? []).map((r) => (
              <tr
                key={r.casino}
                className={r.uninvoiced_keys > 0 || r.missing_months.length > 0 ? t.tableRowBad : ""}
              >
                <td className={t.tableCellName}>{r.casino}</td>
                <td className={t.tableCell}>{r.expected_entries.toLocaleString()}</td>
                <td className={t.tableCell}>{r.invoiced_entries.toLocaleString()}</td>
                <td className={`px-4 py-3 font-mono ${r.uninvoiced_keys ? t.tableCellBad : t.tableCellMuted}`}>
                  {r.uninvoiced_keys}
                </td>
                <td className={`px-4 py-3 font-mono ${r.unexpected_keys ? t.tableCellBad : t.tableCellMuted}`}>
                  {r.unexpected_keys}
                </td>
                <td
                  className={`px-4 py-3 font-mono ${r.gap === 0 ? t.tableCellMuted : r.gap > 0 ? t.tableCellGood : t.tableCellBad}`}
                >
                  {r.gap >= 0 ? "+" : ""}
                  {r.gap}
                </td>
                <td className={t.tableCellMuted}>{r.last_report ?? "—"}</td>
                <td
                  className={`px-4 py-3 font-mono ${
                    r.missing_months.length ? t.tableCellBad : t.tableCellMuted
                  }`}
                  title={r.missing_months.join(", ") || undefined}
                >
                  {r.missing_months.length ? `${r.missing_months.length} (${r.missing_months.join(", ")})` : "0"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
