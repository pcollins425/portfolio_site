import { useEffect, useMemo, useState } from "react";
import { fetchJson, postJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type FlagRow = {
  id: string;
  rule: string;
  side: "high" | "low";
  casino: string;
  serial: string;
  theme?: string | null;
  ym: string;
  prev_ym?: string | null;
  dof: number;
  prev_dof?: number | null;
  coin: number;
  prev_coin?: number | null;
  win: number;
  coin_day: number;
  prev_coin_day?: number | null;
  coin_ratio?: number | null;
  status: string;
  note?: string | null;
};

export type AnalystMonthCount = {
  month: string;
  open: number;
  high: number;
  low: number;
};

export type AnalystYearCount = {
  year: string;
  open: number;
  months_with_open: number;
  months: AnalystMonthCount[];
};

export type AnalystSummary = {
  through: string;
  from_month?: string;
  months_with_open: number;
  years_with_open?: number;
  total_open: number;
  years?: AnalystYearCount[];
  months: AnalystMonthCount[];
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthShort(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTH_SHORT[m - 1] || ym;
}

function groupYears(months: AnalystMonthCount[]): AnalystYearCount[] {
  const years: AnalystYearCount[] = [];
  const byYear = new Map<string, AnalystYearCount>();
  for (const row of months) {
    const year = row.month.slice(0, 4);
    let bucket = byYear.get(year);
    if (!bucket) {
      bucket = { year, open: 0, months_with_open: 0, months: [] };
      byYear.set(year, bucket);
      years.push(bucket);
    }
    bucket.open += row.open;
    bucket.months_with_open += 1;
    bucket.months.push(row);
  }
  return years;
}

const CHIP =
  "rounded-lg border px-2.5 py-1.5 text-sm font-mono";
const CHIP_ON = "border-[#6eb5ff]/40 bg-[#6eb5ff]/15 text-[#f3f5f9]";
const CHIP_OFF = "border-white/10 bg-[#141922] text-[#c5cdd9] hover:border-white/20";

function NeedsLookRail({
  summary,
  focus,
  onMonth,
}: {
  summary: AnalystSummary;
  focus: string;
  onMonth: (ym: string) => void;
}) {
  const t = useDashboardTheme();
  const years = summary.years?.length ? summary.years : groupYears(summary.months || []);
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  const showYears = years.length > 1;
  const activeYear =
    pickedYear ||
    (focus && years.some((y) => y.year === focus.slice(0, 4)) ? focus.slice(0, 4) : null) ||
    years[0]?.year ||
    null;
  const monthChips = showYears ? years.find((y) => y.year === activeYear)?.months ?? [] : summary.months || [];

  if (!years.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs font-medium uppercase tracking-wide ${t.code}`}>Needs a look</span>
        {showYears
          ? years.map((y) => {
              const on = y.year === activeYear;
              return (
                <button
                  key={y.year}
                  type="button"
                  onClick={() => setPickedYear(y.year)}
                  className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
                >
                  {y.year}
                  <span className={on ? "ml-2 text-[#6eb5ff]" : "ml-2 text-amber-300"}>
                    {y.months_with_open}
                  </span>
                </button>
              );
            })
          : monthChips.map((m) => {
              const on = m.month === focus;
              return (
                <button
                  key={m.month}
                  type="button"
                  onClick={() => onMonth(m.month)}
                  className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
                >
                  {m.month}
                  <span className={on ? "ml-2 text-[#6eb5ff]" : "ml-2 text-amber-300"}>{m.open}</span>
                </button>
              );
            })}
      </div>
      {showYears && monthChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {monthChips.map((m) => {
            const on = m.month === focus;
            return (
              <button
                key={m.month}
                type="button"
                onClick={() => onMonth(m.month)}
                className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
              >
                {monthShort(m.month)}
                <span className={on ? "ml-2 text-[#6eb5ff]" : "ml-2 text-amber-300"}>{m.open}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type QueuePayload = {
  source: string;
  month: string;
  prev_month: string;
  cutoff: number;
  coin_day_floor: number;
  compare: string;
  open_count: number;
  count: number;
  flags: FlagRow[];
};

const SELECT_CLS =
  "rounded-lg border border-white/10 bg-[#141922] px-2.5 py-1.5 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40";

const RULE_LABEL: Record<string, string> = {
  coin_high: "Coin/day 5× vs last month",
  coin_low: "Coin/day ÷5 vs last month",
  short_high: "Short stint 5× vs last full month",
  short_low: "Short stint ÷5 vs last full month",
  zero_coin_win: "Coin in $0 with actual win",
};

type SortKey = "casino" | "serial" | "rule" | "ratio" | "coin_day" | "dof";
type SortDir = "asc" | "desc";

const SORT_DEFAULT: Record<SortKey, SortDir> = {
  casino: "asc",
  serial: "asc",
  rule: "asc",
  ratio: "desc",
  coin_day: "desc",
  dof: "desc",
};

function sortFlags(rows: FlagRow[], key: SortKey, dir: SortDir): FlagRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "ratio") {
      const ar = a.coin_ratio;
      const br = b.coin_ratio;
      const aMissing = ar == null || !Number.isFinite(ar);
      const bMissing = br == null || !Number.isFinite(br);
      if (aMissing && bMissing) return a.casino.localeCompare(b.casino);
      if (aMissing) return 1;
      if (bMissing) return -1;
      const cmp = Math.abs(ar) - Math.abs(br);
      if (cmp !== 0) return cmp * sign;
      return a.casino.localeCompare(b.casino);
    }
    if (key === "casino" || key === "serial" || key === "rule") {
      const av =
        key === "rule" ? (RULE_LABEL[a.rule] ?? a.rule) : key === "casino" ? a.casino : a.serial;
      const bv =
        key === "rule" ? (RULE_LABEL[b.rule] ?? b.rule) : key === "casino" ? b.casino : b.serial;
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp * sign;
      return a.serial.localeCompare(b.serial, undefined, { numeric: true });
    }
    const av = key === "dof" ? a.dof : a.coin_day;
    const bv = key === "dof" ? b.dof : b.coin_day;
    if (av !== bv) return (av < bv ? -1 : 1) * sign;
    return a.casino.localeCompare(b.casino);
  });
}

function SortTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (col: SortKey) => void;
}) {
  const on = sortKey === col;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide ${
          on ? "text-[#f3f5f9]" : "hover:text-[#c5cdd9]"
        }`}
      >
        {label}
        <span className="font-mono text-[10px] opacity-80">{on ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

function fmtRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 10) return `${v.toFixed(1)}×`;
  if (v >= 1) return `${v.toFixed(2)}×`;
  return `÷${(1 / v).toFixed(2)}`;
}

function fmtDay(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return fmtUsd(v);
}

export default function AnalystPage({
  summary = null,
  onResolved = () => {},
}: {
  summary?: AnalystSummary | null;
  onResolved?: () => void;
}) {
  const t = useDashboardTheme();
  const { month, periods, setMonth } = useDashboardMonth();
  const focus = month || periods[0]?.slice(0, 7) || "";
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const [data, setData] = useState<QueuePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [ownSummary, setOwnSummary] = useState<AnalystSummary | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("ratio");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const rail = summary ?? ownSummary;

  const sortedFlags = useMemo(
    () => sortFlags(data?.flags ?? [], sortKey, sortDir),
    [data, sortKey, sortDir],
  );

  const cycleSort = (col: SortKey) => {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(col);
    setSortDir(SORT_DEFAULT[col]);
  };

  const reload = (ym: string, filter: "open" | "all") => {
    setLoading(true);
    setErr(null);
    fetchJson<QueuePayload>(withMonthQuery(`/api/analyst/queue?status=${filter}`, ym))
      .then((d) => {
        setData(d);
        setSelectedId((cur) => {
          if (cur && d.flags.some((f) => f.id === cur)) return cur;
          return d.flags[0]?.id ?? null;
        });
      })
      .catch((e: Error) => {
        setData(null);
        setErr(e.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!focus) return;
    reload(focus, statusFilter);
  }, [focus, statusFilter]);

  useEffect(() => {
    if (summary) return;
    const through = periods[0]?.slice(0, 7);
    if (!through) return;
    fetchJson<AnalystSummary>(`/api/analyst/summary?through=${encodeURIComponent(through)}`)
      .then(setOwnSummary)
      .catch(() => setOwnSummary(null));
  }, [summary, periods]);

  const selected = useMemo(
    () => data?.flags.find((f) => f.id === selectedId) ?? null,
    [data, selectedId],
  );

  useEffect(() => {
    setNote("");
    setSaveErr(null);
  }, [selectedId]);

  const resolve = async (status: "confirmed_ok" | "needs_reload") => {
    if (!selected) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await postJson("/api/analyst/queue/resolve", { id: selected.id, status, note });
      setNote("");
      onResolved();
      if (!summary) {
        const through = periods[0]?.slice(0, 7) || focus;
        if (through) {
          fetchJson<AnalystSummary>(`/api/analyst/summary?through=${encodeURIComponent(through)}`)
            .then(setOwnSummary)
            .catch(() => setOwnSummary(null));
        }
      }
      reload(focus, statusFilter);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const forbidden = Boolean(err && (err.startsWith("403") || err.includes("Paul-only")));

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className={t.pageTitle}>Intake queue</h2>
          <p className={t.pageSub}>
            {forbidden
              ? "This queue is Paul-only."
              : err
                ? `Queue unavailable (${err}). Rebuild the API if /api/analyst/queue is missing.`
                : loading
                  ? "Scanning this serial vs last month…"
                  : data
                    ? `${data.open_count} open · ${data.month} vs ${data.prev_month} · coin/day ×${data.cutoff} / ÷${data.cutoff} · not house index`
                    : "Pick a period."}
          </p>
        </div>
        <label className={`inline-flex items-center gap-2 text-sm ${t.code}`}>
          <span className="font-medium">Show</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "open" | "all")}
            className={SELECT_CLS}
          >
            <option value="open">Open</option>
            <option value="all">Open + resolved</option>
          </select>
        </label>
      </section>

      {!forbidden && rail && (rail.months?.length || 0) > 0 && (
        <NeedsLookRail summary={rail} focus={focus} onMonth={setMonth} />
      )}

      {!forbidden && data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={t.kpi}>
            <p className={t.kpiLabel}>Open</p>
            <p className={t.kpiValue}>{data.open_count}</p>
            <p className={t.kpiSub}>Won’t clear until a note is written</p>
          </div>
          <div className={t.kpi}>
            <p className={t.kpiLabel}>Too high</p>
            <p className={t.kpiValue}>
              {data.flags.filter((f) => f.side === "high" && f.status === "open").length}
            </p>
            <p className={t.kpiSub}>Extra digit / dump / mixup</p>
          </div>
          <div className={t.kpi}>
            <p className={t.kpiLabel}>Too low</p>
            <p className={t.kpiValue}>
              {data.flags.filter((f) => f.side === "low" && f.status === "open").length}
            </p>
            <p className={t.kpiSub}>Missing digit / dead meters</p>
          </div>
        </div>
      )}

      {!forbidden && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className={`${t.tableWrap} lg:col-span-3 overflow-x-auto`}>
            <table className="w-full text-left text-sm">
              <thead className={t.tableHead}>
                <tr>
                  <SortTh label="Casino" col="casino" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                  <SortTh label="Serial" col="serial" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                  <SortTh label="Rule" col="rule" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                  <SortTh label="Ratio" col="ratio" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                  <SortTh label="Coin/day" col="coin_day" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                  <SortTh label="DOF" col="dof" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                </tr>
              </thead>
              <tbody className={t.tableRow}>
                {sortedFlags.map((r) => (
                  <tr
                    key={r.id}
                    className={`${r.side === "high" || r.rule === "zero_coin_win" ? t.tableRowBad : ""} cursor-pointer ${
                      r.id === selectedId ? "outline outline-1 outline-[#6eb5ff]/40" : ""
                    }`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className={t.tableCellName}>{r.casino}</td>
                    <td className={t.tableCell}>{r.serial}</td>
                    <td className={t.tableCellMuted}>{RULE_LABEL[r.rule] ?? r.rule}</td>
                    <td className={`px-4 py-3 font-mono ${r.side === "high" ? t.tableCellBad : t.tableCellGood}`}>
                      {r.rule === "zero_coin_win" ? "win / $0 coin" : fmtRatio(r.coin_ratio)}
                    </td>
                    <td className={t.tableCellMuted}>
                      {fmtDay(r.prev_coin_day)} → {fmtDay(r.coin_day)}
                    </td>
                    <td className={t.tableCellMuted}>
                      {r.prev_dof != null ? `${r.prev_dof.toFixed(0)}→` : ""}
                      {r.dof.toFixed(0)}
                    </td>
                  </tr>
                ))}
                {!loading && data && data.flags.length === 0 && (
                  <tr>
                    <td className={`${t.tableCellMuted} px-4 py-6`} colSpan={6}>
                      Nothing open for {data.month}. That’s the point of a short list.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <section className={`${t.panel} lg:col-span-2`}>
            <p className={t.panelLabel}>Resolve</p>
            {selected ? (
              <div className="mt-3 space-y-3 text-sm">
                <p className="text-[#f3f5f9]">
                  {selected.casino} · {selected.serial}
                  {selected.theme ? ` · ${selected.theme}` : ""}
                </p>
                <p className={t.code}>{RULE_LABEL[selected.rule] ?? selected.rule}</p>
                <p className={t.code}>
                  {selected.prev_ym ?? "—"} → {selected.ym} · ratio {fmtRatio(selected.coin_ratio)}
                </p>
                <p className={t.code}>
                  Coin {fmtUsd(selected.prev_coin ?? 0)} → {fmtUsd(selected.coin)} · win {fmtUsd(selected.win)}
                </p>
                {selected.status !== "open" && selected.note && (
                  <p className={t.calloutBody}>Last note: {selected.note}</p>
                )}
                <label className={`block text-sm ${t.code}`}>
                  Note (required)
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder="Why this is real heat, a vendor dump, or what has to be reloaded."
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#141922] px-2.5 py-2 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40"
                  />
                </label>
                {saveErr && <p className="text-sm text-rose-300">{saveErr}</p>}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || selected.status !== "open"}
                    onClick={() => resolve("confirmed_ok")}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200 disabled:opacity-40"
                  >
                    Confirmed ok
                  </button>
                  <button
                    type="button"
                    disabled={saving || selected.status !== "open"}
                    onClick={() => resolve("needs_reload")}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200 disabled:opacity-40"
                  >
                    Needs reload
                  </button>
                </div>
                <p className={`text-xs ${t.code}`}>
                  Does not edit Master_Revenue. Reload close is a note that this row has to go back through the
                  processor.
                </p>
              </div>
            ) : (
              <p className={`mt-3 text-sm ${t.code}`}>Select a row.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
