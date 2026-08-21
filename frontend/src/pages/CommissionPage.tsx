import { useEffect, useMemo, useState } from "react";
import { fetchJson, postJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type FlagRow = {
  id: string;
  kind: "delta" | "missing" | "unknown" | string;
  casino: string;
  serial: string;
  theme?: string | null;
  vendor?: string | null;
  ym: string;
  dof?: number | null;
  actual_win?: number | null;
  reported_a?: number | null;
  calculated_b?: number | null;
  delta?: number | null;
  commission_id?: number | null;
  profile_id?: string | null;
  recipe?: string | null;
  detail?: string | null;
  status: string;
  note?: string | null;
  notes?: { at?: string; by?: string; status?: string; note?: string }[];
  resolved_at?: string | null;
  resolved_by?: string | null;
};

export type CommissionMonthCount = {
  month: string;
  open: number;
  delta: number;
  missing: number;
  unknown: number;
};

export type CommissionYearCount = {
  year: string;
  open: number;
  months_with_open: number;
  months: CommissionMonthCount[];
};

export type CommissionSummary = {
  through: string;
  from_month?: string;
  months_with_open: number;
  years_with_open?: number;
  total_open: number;
  years?: CommissionYearCount[];
  months: CommissionMonthCount[];
  roots?: {
    casinos_with_missing_profile?: string[];
    unknown_cids?: number[];
  };
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthShort(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTH_SHORT[m - 1] || ym;
}

function groupYears(months: CommissionMonthCount[]): CommissionYearCount[] {
  const years: CommissionYearCount[] = [];
  const byYear = new Map<string, CommissionYearCount>();
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

const CHIP = "rounded-lg border px-2.5 py-1.5 text-sm font-mono";
const CHIP_ON = "border-[#6eb5ff]/40 bg-[#6eb5ff]/15 text-[#f3f5f9]";
const CHIP_OFF = "border-white/10 bg-[#141922] text-[#c5cdd9] hover:border-white/20";
const SELECT_CLS =
  "rounded-lg border border-white/10 bg-[#141922] px-2.5 py-1.5 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40";

const KIND_LABEL: Record<string, string> = {
  delta: "A ≠ B",
  missing: "Missing CID",
  unknown: "No formula",
};

const CLOSE_LABEL: Record<string, string> = {
  bill_a: "Bill reported (A)",
  bill_b: "Bill calculated (B)",
  needs_root_fix: "Needs root fix",
  amount_due_only: "Amount-due only",
};

function NeedsLookRail({
  summary,
  focus,
  onMonth,
}: {
  summary: CommissionSummary;
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
  open_count: number;
  kind_counts: { delta: number; missing: number; unknown: number };
  count: number;
  flags: FlagRow[];
};

type SortKey = "casino" | "serial" | "kind" | "delta" | "a" | "b";
type SortDir = "asc" | "desc";
const SORT_DEFAULT: Record<SortKey, SortDir> = {
  casino: "asc",
  serial: "asc",
  kind: "asc",
  delta: "desc",
  a: "desc",
  b: "desc",
};

function sortFlags(flags: FlagRow[], key: SortKey, dir: SortDir): FlagRow[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...flags].sort((a, b) => {
    const av =
      key === "delta"
        ? a.delta ?? -1
        : key === "a"
          ? a.reported_a ?? -1
          : key === "b"
            ? a.calculated_b ?? -1
            : key === "kind"
              ? a.kind
              : key === "serial"
                ? a.serial
                : a.casino;
    const bv =
      key === "delta"
        ? b.delta ?? -1
        : key === "a"
          ? b.reported_a ?? -1
          : key === "b"
            ? b.calculated_b ?? -1
            : key === "kind"
              ? b.kind
              : key === "serial"
                ? b.serial
                : b.casino;
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return 0;
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
  onSort: (c: SortKey) => void;
}) {
  const on = sortKey === col;
  return (
    <th className="cursor-pointer px-3 py-2 font-medium text-[#9aa3b2]" onClick={() => onSort(col)}>
      {label}
      {on ? <span className="ml-1 text-[#6eb5ff]">{sortDir === "asc" ? "↑" : "↓"}</span> : null}
    </th>
  );
}

function money(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return fmtUsd(v);
}

export default function CommissionPage({
  summary = null,
  onResolved = () => {},
}: {
  summary?: CommissionSummary | null;
  onResolved?: () => void;
}) {
  const t = useDashboardTheme();
  const { month, periods, setMonth } = useDashboardMonth();
  const focus = month || periods[0]?.slice(0, 7) || "";
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const [kindFilter, setKindFilter] = useState<"all" | "delta" | "missing" | "unknown" | "roots">("all");
  const [data, setData] = useState<QueuePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [ownSummary, setOwnSummary] = useState<CommissionSummary | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("delta");
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

  const reload = (ym: string, filter: "open" | "all", kind: typeof kindFilter) => {
    setLoading(true);
    setErr(null);
    const q = withMonthQuery(
      `/api/commission-contract/queue?status=${filter}&kind=${kind}`,
      ym,
    );
    fetchJson<QueuePayload>(q)
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
    reload(focus, statusFilter, kindFilter);
  }, [focus, statusFilter, kindFilter]);

  useEffect(() => {
    if (summary) return;
    const through = periods[0]?.slice(0, 7);
    if (!through) return;
    fetchJson<CommissionSummary>(
      `/api/commission-contract/summary?through=${encodeURIComponent(through)}`,
    )
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

  const resolve = async (
    status: "bill_a" | "bill_b" | "needs_root_fix" | "amount_due_only",
  ) => {
    if (!selected) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await postJson("/api/commission-contract/queue/resolve", {
        id: selected.id,
        status,
        note,
      });
      setNote("");
      onResolved();
      if (!summary) {
        const through = periods[0]?.slice(0, 7) || focus;
        if (through) {
          fetchJson<CommissionSummary>(
            `/api/commission-contract/summary?through=${encodeURIComponent(through)}`,
          )
            .then(setOwnSummary)
            .catch(() => setOwnSummary(null));
        }
      }
      reload(focus, statusFilter, kindFilter);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const forbidden = Boolean(err && (err.startsWith("403") || err.includes("Paul-only")));
  const roots = rail?.roots;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className={t.pageTitle}>Commission contract</h2>
          <p className={t.pageSub}>
            {forbidden
              ? "This queue is Paul-only."
              : err
                ? `Queue unavailable (${err}). Rebuild the API if /api/commission-contract/queue is missing.`
                : loading
                  ? "Comparing reported commission to stamped CID formula…"
                  : data
                    ? `${data.open_count} open · ${data.month} · seat |Δ| ≥ $1.00 · A and B on the same row`
                    : "Pick a month on the rail."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`inline-flex items-center gap-2 text-sm ${t.code}`}>
            <span className="font-medium">Kind</span>
            <select
              value={kindFilter}
              onChange={(e) =>
                setKindFilter(e.target.value as typeof kindFilter)
              }
              className={SELECT_CLS}
            >
              <option value="all">All</option>
              <option value="delta">A ≠ B</option>
              <option value="missing">Missing CID</option>
              <option value="unknown">No formula</option>
              <option value="roots">Roots (missing + unknown)</option>
            </select>
          </label>
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
        </div>
      </section>

      {!forbidden && rail && (rail.months?.length || 0) > 0 && (
        <NeedsLookRail summary={rail} focus={focus} onMonth={setMonth} />
      )}

      {!forbidden && roots && (
        <div className={`rounded-lg border border-white/10 bg-[#141922] px-3 py-2 text-sm ${t.code}`}>
          <span className="font-medium text-[#f3f5f9]">Roots · </span>
          {(roots.casinos_with_missing_profile?.length ?? 0) > 0
            ? `${roots.casinos_with_missing_profile!.length} casinos missing profile`
            : "no missing profiles"}
          {" · "}
          {(roots.unknown_cids?.length ?? 0) > 0
            ? `unknown CIDs ${roots.unknown_cids!.join(", ")}`
            : "no unknown CIDs"}
        </div>
      )}

      {!forbidden && data && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className={t.kpi}>
            <p className={t.kpiLabel}>Open</p>
            <p className={t.kpiValue}>{data.open_count}</p>
            <p className={t.kpiSub}>Won’t clear until noted</p>
          </div>
          <div className={t.kpi}>
            <p className={t.kpiLabel}>A ≠ B</p>
            <p className={t.kpiValue}>{data.kind_counts?.delta ?? 0}</p>
            <p className={t.kpiSub}>Seat |Δ| ≥ $1</p>
          </div>
          <div className={t.kpi}>
            <p className={t.kpiLabel}>Missing CID</p>
            <p className={t.kpiValue}>{data.kind_counts?.missing ?? 0}</p>
            <p className={t.kpiSub}>Stamp SMM profile</p>
          </div>
          <div className={t.kpi}>
            <p className={t.kpiLabel}>No formula</p>
            <p className={t.kpiValue}>{data.kind_counts?.unknown ?? 0}</p>
            <p className={t.kpiSub}>Add recipe or amount-due-only</p>
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
                  <SortTh label="Kind" col="kind" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                  <SortTh label="Reported A" col="a" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                  <SortTh label="Calc B" col="b" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                  <SortTh label="Δ" col="delta" sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />
                </tr>
              </thead>
              <tbody className={t.tableRow}>
                {sortedFlags.map((r) => (
                  <tr
                    key={r.id}
                    className={`${r.kind === "delta" ? t.tableRowBad : ""} cursor-pointer ${
                      r.id === selectedId ? "outline outline-1 outline-[#6eb5ff]/40" : ""
                    }`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className={t.tableCellName}>{r.casino}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.serial}</td>
                    <td className="px-3 py-2">{KIND_LABEL[r.kind] || r.kind}</td>
                    <td className="px-3 py-2 font-mono text-xs">{money(r.reported_a)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{money(r.calculated_b)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{money(r.delta)}</td>
                  </tr>
                ))}
                {!loading && sortedFlags.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-[#9aa3b2]">
                      No flags for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-xl border border-white/10 bg-[#141922] p-4">
              {!selected ? (
                <p className={`text-sm ${t.code}`}>Select a row.</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[#9aa3b2]">Flag</p>
                    <p className="mt-1 font-medium text-[#f3f5f9]">
                      {selected.casino} · {selected.serial}
                    </p>
                    <p className={`mt-1 ${t.code}`}>
                      {KIND_LABEL[selected.kind] || selected.kind}
                      {selected.commission_id != null ? ` · CID ${selected.commission_id}` : ""}
                      {selected.recipe ? ` · ${selected.recipe}` : ""}
                    </p>
                    {selected.profile_id ? (
                      <p className={`mt-1 font-mono text-xs ${t.code}`}>{selected.profile_id}</p>
                    ) : null}
                    {selected.detail ? <p className={`mt-2 ${t.code}`}>{selected.detail}</p> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[#9aa3b2]">Reported (A)</p>
                      <p className="mt-1 font-mono text-[#f3f5f9]">{money(selected.reported_a)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[#9aa3b2]">Calculated (B)</p>
                      <p className="mt-1 font-mono text-[#f3f5f9]">{money(selected.calculated_b)}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[#9aa3b2]">Status</p>
                    <p className="mt-1 text-[#f3f5f9]">
                      {selected.status === "open"
                        ? "Open"
                        : CLOSE_LABEL[selected.status] || selected.status}
                    </p>
                    {selected.note ? (
                      <p className={`mt-2 whitespace-pre-wrap ${t.code}`}>{selected.note}</p>
                    ) : null}
                  </div>
                  {selected.status === "open" ? (
                    <>
                      <label className="block">
                        <span className="text-xs uppercase tracking-wide text-[#9aa3b2]">Note</span>
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={4}
                          className="mt-1 w-full rounded-lg border border-white/10 bg-[#0f131a] px-3 py-2 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40"
                          placeholder="Why bill A, bill B, root fix, or amount-due-only…"
                        />
                      </label>
                      {saveErr ? <p className="text-sm text-rose-300">{saveErr}</p> : null}
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            "bill_a",
                            "bill_b",
                            "needs_root_fix",
                            "amount_due_only",
                          ] as const
                        ).map((st) => (
                          <button
                            key={st}
                            type="button"
                            disabled={saving}
                            onClick={() => void resolve(st)}
                            className="rounded-lg border border-white/10 bg-[#0f131a] px-2.5 py-1.5 text-xs text-[#c5cdd9] hover:border-[#6eb5ff]/40 disabled:opacity-40"
                          >
                            {CLOSE_LABEL[st]}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
