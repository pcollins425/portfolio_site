import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { fetchJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type Metric = "tdw" | "adw";

type MatrixPayload = {
  performance_month?: string;
  months?: string[];
  casinos?: CasinoRow[];
  floor?: { tdw?: Record<string, number | null>; adw?: Record<string, number | null> };
  error?: string;
};

type CasinoRow = {
  casino_id: string;
  casino_name: string;
  tdw: Record<string, number | null>;
  adw: Record<string, number | null>;
  tdw_avg: number | null;
  adw_avg: number | null;
};

type SerialRow = {
  serial: string;
  tdw: number | null;
  adw: number | null;
  days: number | null;
};

type ThemeNode = { theme: string; serials: SerialRow[] };

type SignGroup = {
  ssm: string;
  sign_serial: string;
  themes: ThemeNode[];
};

type CellPayload = {
  casino_name?: string;
  month?: string;
  units?: number;
  vendors?: {
    vendor: string;
    cabinets: {
      cabinet: string;
      sign_groups: SignGroup[];
      themes: ThemeNode[];
    }[];
  }[];
};

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function trendStyle(curr: number | null | undefined, prev: number | null | undefined): string {
  if (curr == null || prev == null || prev <= 0) return "";
  const pct = (curr - prev) / prev;
  if (Math.abs(pct) < 0.02) return "";
  const mag = Math.min(1, Math.abs(pct) / 0.25);
  const alpha = (0.12 + mag * 0.38).toFixed(2);
  if (pct > 0) return `background-color: rgba(34, 197, 94, ${alpha}); color: #d1fae5;`;
  return `background-color: rgba(239, 68, 68, ${alpha}); color: #fecaca;`;
}

function priorValue(
  values: Record<string, number | null | undefined>,
  months: string[],
  index: number,
): { value: number; month: string } | null {
  for (let j = index - 1; j >= 0; j -= 1) {
    const v = values[months[j]];
    if (v != null) return { value: v, month: months[j] };
  }
  return null;
}

function hoverTitle(
  values: Record<string, number | null | undefined>,
  months: string[],
  index: number,
  curr: number,
) {
  const prev = priorValue(values, months, index);
  if (!prev) return `${monthLabel(months[index])}: ${fmtUsd(curr)} · no prior month`;
  const pct = (curr - prev.value) / prev.value;
  const sign = pct >= 0 ? "+" : "";
  return `${monthLabel(prev.month)}: ${fmtUsd(prev.value)} → ${monthLabel(months[index])}: ${fmtUsd(curr)} · ${sign}${(pct * 100).toFixed(1)}%`;
}

function SerialLine({ row }: { row: SerialRow }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-white/5 py-1.5 text-xs">
      <span className="font-mono text-[#f3f5f9]">{row.serial}</span>
      <span className="text-[#c5cdd9]">
        TDW {row.tdw != null ? fmtUsd(row.tdw) : "—"}
        <span className="mx-2 text-[#8b96a8]">·</span>
        ADW {row.adw != null ? fmtUsd(row.adw) : "—"}
        <span className="mx-2 text-[#8b96a8]">·</span>
        {row.days != null ? `${row.days} days` : "—"}
      </span>
    </div>
  );
}

function ThemeBlock({ node }: { node: ThemeNode }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-[#d7deea]">{node.theme}</p>
      {node.serials.map((row) => (
        <SerialLine key={row.serial} row={row} />
      ))}
    </div>
  );
}

export default function PerformancePage() {
  const t = useDashboardTheme();
  const { month } = useDashboardMonth();
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cell, setCell] = useState<CellPayload | null>(null);
  const [cellErr, setCellErr] = useState<string | null>(null);
  const [cellLoading, setCellLoading] = useState(false);
  const [open, setOpen] = useState<{ casinoId: string; ym: string } | null>(null);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    fetchJson<MatrixPayload>(withMonthQuery("/api/performance/casino-month", month))
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

  const months = data?.months ?? [];
  const casinos = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = data?.casinos ?? [];
    if (!q) return rows;
    return rows.filter((row) => row.casino_name.toLowerCase().includes(q));
  }, [data, search]);

  function openCell(casinoId: string, ym: string) {
    setOpen({ casinoId, ym });
    setCell(null);
    setCellErr(null);
    setCellLoading(true);
    const path = `/api/performance/casino-month/cell?casino_id=${encodeURIComponent(casinoId)}&month=${encodeURIComponent(ym)}`;
    fetchJson<CellPayload>(path)
      .then((d) => setCell(d))
      .catch((e: Error) => setCellErr(e.message))
      .finally(() => setCellLoading(false));
  }

  function renderTable(metric: Metric, title: string) {
    const floor = data?.floor?.[metric] ?? {};
    return (
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold text-[#9ecbff]">{title}</h3>
        <div className="max-h-[640px] overflow-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-[#1a2130] px-3 py-2 text-left font-medium text-[#8b96a8]">
                  Casino
                </th>
                {months.map((ym) => (
                  <th
                    key={ym}
                    className="sticky top-0 z-10 bg-[#1a2130] px-2 py-2 text-right font-medium text-[#8b96a8]"
                  >
                    {monthLabel(ym)}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-[#1a2130] px-2 py-2 text-right font-semibold text-[#f3f5f9]">
                  Avg
                </th>
              </tr>
            </thead>
            <tbody>
              {casinos.map((row) => {
                const values = row[metric];
                return (
                  <tr key={row.casino_id} className="border-t border-white/5">
                    <td className="sticky left-0 z-10 bg-[#141922] px-3 py-1.5 text-left font-medium text-[#f3f5f9]">
                      {row.casino_name}
                    </td>
                    {months.map((ym, i) => {
                      const v = values[ym];
                      if (v == null) {
                        return (
                          <td key={ym} className="px-2 py-1.5 text-right text-[#5c6778]">
                            —
                          </td>
                        );
                      }
                      const prev = priorValue(values, months, i);
                      return (
                        <td key={ym} className="p-0 text-right">
                          <button
                            type="button"
                            className="w-full px-2 py-1.5 text-right font-mono text-[#e8edf5]"
                            style={{ background: "transparent", ...styleObject(trendStyle(v, prev?.value)) }}
                            title={hoverTitle(values, months, i, v)}
                            onClick={() => openCell(row.casino_id, ym)}
                          >
                            {fmtUsd(v)}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-[#f3f5f9]">
                      {row[metric === "tdw" ? "tdw_avg" : "adw_avg"] != null
                        ? fmtUsd(row[metric === "tdw" ? "tdw_avg" : "adw_avg"] as number)
                        : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#6eb5ff]/50">
                <td className="sticky left-0 z-10 bg-[#141922] px-3 py-2 text-left font-semibold text-[#f3f5f9]">
                  Month avg
                </td>
                {months.map((ym, i) => {
                  const v = floor[ym];
                  if (v == null) return <td key={ym} />;
                  const prev = priorValue(floor, months, i);
                  return (
                    <td
                      key={ym}
                      className="px-2 py-2 text-right font-mono font-semibold"
                      style={styleObject(trendStyle(v, prev?.value))}
                      title={hoverTitle(floor, months, i, v)}
                    >
                      {fmtUsd(v)}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  const through = data?.performance_month ? monthLabel(data.performance_month) : "the latest performance month";

  return (
    <div className="space-y-4">
      <header>
        <h2 className={t.pageTitle}>Casino × month</h2>
        <p className={`mt-1 max-w-3xl text-sm ${t.pageSub}`}>
          {loading
            ? "Loading the six-month grid…"
            : err
              ? err
              : `Average theoretical and actual daily win through ${through}. Each cell is that house versus its prior month. A change under 2% stays neutral. A blank house has not reported.`}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search casino…"
          className="w-64 rounded-lg border border-white/10 bg-[#141922] px-3 py-1.5 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40"
        />
        <span className="text-xs text-[#8b96a8]">
          {casinos.length.toLocaleString()} casinos · {months.length} months
        </span>
      </div>

      {!loading && !err ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {renderTable("tdw", "Avg TDW")}
          {renderTable("adw", "Avg ADW")}
        </div>
      ) : null}

      {open ? (
        <section className="rounded-xl border border-white/10 bg-[#141922] p-4">
          <h3 className="text-sm font-semibold text-[#f3f5f9]">
            {cell?.casino_name || "Casino"} · {monthLabel(open.ym)}
            {cell?.units != null ? (
              <span className="ml-2 font-normal text-[#8b96a8]">
                {cell.units} unit{cell.units === 1 ? "" : "s"}
              </span>
            ) : null}
          </h3>
          {cellLoading ? <p className="mt-2 text-sm text-[#8b96a8]">Loading the units…</p> : null}
          {cellErr ? <p className="mt-2 text-sm text-rose-300">{cellErr}</p> : null}
          {cell?.vendors?.map((vendor) => (
            <div key={vendor.vendor} className="mt-4">
              <p className="text-sm font-semibold text-[#9ecbff]">{vendor.vendor}</p>
              {vendor.cabinets.map((cabinet) => (
                <div key={cabinet.cabinet} className="mt-2 pl-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8b96a8]">{cabinet.cabinet}</p>
                  {cabinet.sign_groups.map((group) => (
                    <div key={group.ssm} className="mt-2 rounded-lg border border-white/10 px-3 py-2">
                      <p className="text-sm text-[#f3f5f9]">
                        Sign {group.sign_serial || group.ssm}
                        <span className="ml-2 font-mono text-xs text-[#8b96a8]">{group.ssm}</span>
                      </p>
                      {group.themes.map((node) => (
                        <ThemeBlock key={node.theme} node={node} />
                      ))}
                    </div>
                  ))}
                  {cabinet.themes.map((node) => (
                    <ThemeBlock key={node.theme} node={node} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function styleObject(css: string): CSSProperties {
  if (!css) return {};
  const out: Record<string, string> = {};
  for (const part of css.split(";")) {
    const [rawKey, rawVal] = part.split(":");
    if (!rawKey || !rawVal) continue;
    const key = rawKey.trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = rawVal.trim();
  }
  return out;
}
