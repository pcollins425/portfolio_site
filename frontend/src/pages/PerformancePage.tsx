import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { fetchJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type Metric = "tdw" | "adw";

type Measures = {
  tdw: Record<string, number | null>;
  adw: Record<string, number | null>;
  theo?: Record<string, number | null>;
  actual?: Record<string, number | null>;
  tdw_avg: number | null;
  adw_avg: number | null;
  theo_avg?: number | null;
  actual_avg?: number | null;
};

type MatrixPayload = {
  performance_month?: string;
  months?: string[];
  casinos?: (Measures & { casino_id: string; casino_name: string })[];
  floor?: {
    tdw?: Record<string, number | null>;
    adw?: Record<string, number | null>;
    theo?: Record<string, number | null>;
    actual?: Record<string, number | null>;
  };
  error?: string;
};

type LeaderRow = { name: string; theo_index: number; units: number; detail?: string };
type LeadersPayload = {
  themes?: LeaderRow[];
  cabinets?: LeaderRow[];
  signs?: LeaderRow[];
  regions?: LeaderRow[];
};

type SerialNode = Measures & { serial: string; slot_master_id?: string };
type ThemeNode = Measures & { theme: string; serials: SerialNode[] };
type SignNode = Measures & { ssm: string; sign_serial: string; themes: ThemeNode[] };
type CabinetNode = Measures & { cabinet: string; sign_groups: SignNode[]; themes: ThemeNode[] };
type VendorNode = Measures & { vendor: string; cabinets: CabinetNode[] };
type ExpandPayload = { vendors?: VendorNode[] };

type CasinoRow = Measures & { casino_id: string; casino_name: string };

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function indexStyle(index: number | null | undefined): string {
  if (index == null) return "";
  const delta = index - 1;
  if (Math.abs(delta) < 0.02) return "";
  const mag = Math.min(1, Math.abs(delta) / 0.25);
  const alpha = (0.12 + mag * 0.38).toFixed(2);
  if (delta > 0) return `background-color: rgba(34, 197, 94, ${alpha}); color: #d1fae5;`;
  return `background-color: rgba(239, 68, 68, ${alpha}); color: #fecaca;`;
}

function indexTitle(ym: string, dollars: number, index: number | null | undefined) {
  const base = `${monthLabel(ym)}: ${fmtUsd(dollars)}`;
  if (index == null) return `${base} · no house average`;
  return `${base} · index ${index.toFixed(2)}`;
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

function valueCells(
  values: Record<string, number | null | undefined>,
  avg: number | null,
  indexes: Record<string, number | null | undefined>,
  indexAvg: number | null,
  months: string[],
) {
  return (
    <>
      {months.map((ym) => {
        const v = values[ym];
        if (v == null) {
          return (
            <td key={ym} className="px-2 py-1.5 text-right text-[#5c6778]">
              —
            </td>
          );
        }
        const index = indexes[ym];
        return (
          <td
            key={ym}
            className="px-2 py-1.5 text-right font-mono text-[#e8edf5]"
            style={styleObject(indexStyle(index))}
            title={indexTitle(ym, v, index)}
          >
            {fmtUsd(v)}
          </td>
        );
      })}
      <td
        className="px-2 py-1.5 text-right font-mono font-semibold text-[#f3f5f9]"
        style={styleObject(indexStyle(indexAvg))}
        title={indexAvg != null ? `Index ${indexAvg.toFixed(2)}` : undefined}
      >
        {avg != null ? fmtUsd(avg) : ""}
      </td>
    </>
  );
}

function LeaderList({ title, note, rows }: { title: string; note: string; rows: LeaderRow[] }) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#141922] p-3">
      <h3 className="text-sm font-semibold text-[#9ecbff]">{title}</h3>
      <p className="mb-2 text-[11px] text-[#8b96a8]">{note}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-[#5c6778]">None in this window.</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((row, i) => (
            <li key={`${row.name}-${i}`} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="text-[#8b96a8]">{i + 1}. </span>
                <span className="text-[#f3f5f9]">{row.name}</span>
                {row.detail ? <span className="mt-0.5 block truncate text-[11px] text-[#8b96a8]">{row.detail}</span> : null}
              </span>
              <span className="shrink-0 text-right">
                <span className="rounded px-1.5 py-0.5 font-mono text-xs" style={styleObject(indexStyle(row.theo_index))}>
                  {row.theo_index.toFixed(2)}
                </span>
                <span className="mt-0.5 block text-[10px] text-[#8b96a8]">{row.units.toLocaleString()} units</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function PerformancePage() {
  const t = useDashboardTheme();
  const { month } = useDashboardMonth();
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [leaders, setLeaders] = useState<LeadersPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [trees, setTrees] = useState<Record<string, ExpandPayload>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setLeaders(null);
    setOpen(new Set());
    setTrees({});
    fetchJson<LeadersPayload>(withMonthQuery("/api/performance/leaders", month))
      .then((d) => {
        if (!dead) setLeaders(d);
      })
      .catch(() => {
        if (!dead) setLeaders(null);
      });
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

  function toggle(key: string, casinoId?: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!casinoId || trees[casinoId] || loadingId === casinoId) return;
    setLoadingId(casinoId);
    fetchJson<ExpandPayload>(
      withMonthQuery(
        `/api/performance/casino-month/expand?casino_id=${encodeURIComponent(casinoId)}`,
        month,
      ),
    )
      .then((d) => setTrees((prev) => ({ ...prev, [casinoId]: d })))
      .catch(() => setTrees((prev) => ({ ...prev, [casinoId]: { vendors: [] } })))
      .finally(() => setLoadingId((cur) => (cur === casinoId ? null : cur)));
  }

  function labelCell(key: string, depth: number, text: string, canOpen: boolean, casinoId?: string) {
    const expanded = open.has(key);
    return (
      <td className="sticky left-0 z-10 bg-[#141922] px-2 py-1.5 text-left">
        <button
          type="button"
          className="flex w-full items-center gap-1 text-left text-[#f3f5f9]"
          style={{ paddingLeft: depth * 14 }}
          onClick={() => canOpen && toggle(key, casinoId)}
        >
          <span className="inline-block w-3 text-[10px] text-[#8b96a8]">{canOpen ? (expanded ? "▾" : "▸") : ""}</span>
          <span className={depth === 0 ? "font-medium" : depth >= 4 ? "font-mono text-[11px]" : ""}>{text}</span>
        </button>
      </td>
    );
  }

  function metricOf(node: Measures, metric: Metric) {
    return metric === "tdw" ? node.tdw : node.adw;
  }

  function avgOf(node: Measures, metric: Metric) {
    return metric === "tdw" ? node.tdw_avg : node.adw_avg;
  }

  function indexOf(node: Measures, metric: Metric) {
    return (metric === "tdw" ? node.theo : node.actual) ?? {};
  }

  function indexAvgOf(node: Measures, metric: Metric) {
    return (metric === "tdw" ? node.theo_avg : node.actual_avg) ?? null;
  }

  function childRows(casino: CasinoRow, metric: Metric): ReactNode[] {
    if (!open.has(casino.casino_id)) return [];
    const tree = trees[casino.casino_id];
    if (!tree) {
      return [
        <tr key={`${casino.casino_id}-loading`} className="border-t border-white/5">
          <td className="sticky left-0 z-10 bg-[#141922] px-8 py-1.5 text-xs text-[#8b96a8]" colSpan={months.length + 2}>
            Loading…
          </td>
        </tr>,
      ];
    }
    const out: ReactNode[] = [];
    for (const vendor of tree.vendors ?? []) {
      const vk = `${casino.casino_id}|${vendor.vendor}`;
      out.push(
        <tr key={vk} className="border-t border-white/5">
          {labelCell(vk, 1, vendor.vendor, vendor.cabinets.length > 0)}
          {valueCells(metricOf(vendor, metric), avgOf(vendor, metric), indexOf(vendor, metric), indexAvgOf(vendor, metric), months)}
        </tr>,
      );
      if (!open.has(vk)) continue;
      for (const cabinet of vendor.cabinets) {
        const ck = `${vk}|${cabinet.cabinet}`;
        const canCabinet = cabinet.sign_groups.length + cabinet.themes.length > 0;
        out.push(
          <tr key={ck} className="border-t border-white/5">
            {labelCell(ck, 2, cabinet.cabinet, canCabinet)}
            {valueCells(metricOf(cabinet, metric), avgOf(cabinet, metric), indexOf(cabinet, metric), indexAvgOf(cabinet, metric), months)}
          </tr>,
        );
        if (!open.has(ck)) continue;
        for (const group of cabinet.sign_groups) {
          const gk = `${ck}|sign:${group.ssm}`;
          const signLabel = group.sign_serial ? `Sign ${group.sign_serial}` : `Sign ${group.ssm}`;
          out.push(
            <tr key={gk} className="border-t border-white/5">
              {labelCell(gk, 3, signLabel, group.themes.length > 0)}
              {valueCells(metricOf(group, metric), avgOf(group, metric), indexOf(group, metric), indexAvgOf(group, metric), months)}
            </tr>,
          );
          if (!open.has(gk)) continue;
          out.push(...themeRows(gk, 4, group.themes, metric));
        }
        out.push(...themeRows(ck, 3, cabinet.themes, metric));
      }
    }
    return out;
  }

  function themeRows(parent: string, depth: number, themes: ThemeNode[], metric: Metric): ReactNode[] {
    const out: ReactNode[] = [];
    for (const theme of themes) {
      const tk = `${parent}|theme:${theme.theme}`;
      out.push(
        <tr key={tk} className="border-t border-white/5">
          {labelCell(tk, depth, theme.theme, theme.serials.length > 0)}
          {valueCells(metricOf(theme, metric), avgOf(theme, metric), indexOf(theme, metric), indexAvgOf(theme, metric), months)}
        </tr>,
      );
      if (!open.has(tk)) continue;
      for (const serial of theme.serials) {
        const sk = `${tk}|${serial.slot_master_id || serial.serial}`;
        out.push(
          <tr key={sk} className="border-t border-white/5">
            {labelCell(sk, depth + 1, serial.serial, false)}
            {valueCells(metricOf(serial, metric), avgOf(serial, metric), indexOf(serial, metric), indexAvgOf(serial, metric), months)}
          </tr>,
        );
      }
    }
    return out;
  }

  function renderTable(metric: Metric, title: string) {
    const floor = data?.floor?.[metric] ?? {};
    const floorIndex = (metric === "tdw" ? data?.floor?.theo : data?.floor?.actual) ?? {};
    return (
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold text-[#9ecbff]">{title}</h3>
        <div className="max-h-[720px] overflow-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-[220px] bg-[#1a2130] px-3 py-2 text-left font-medium text-[#8b96a8]">
                  Casino
                </th>
                {months.map((ym) => (
                  <th key={ym} className="sticky top-0 z-10 bg-[#1a2130] px-2 py-2 text-right font-medium text-[#8b96a8]">
                    {monthLabel(ym)}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-[#1a2130] px-2 py-2 text-right font-semibold text-[#f3f5f9]">Avg</th>
              </tr>
            </thead>
            <tbody>
              {casinos.map((row) => (
                <Fragment key={row.casino_id}>
                  <tr className="border-t border-white/5">
                    {labelCell(row.casino_id, 0, row.casino_name, true, row.casino_id)}
                    {valueCells(metricOf(row, metric), avgOf(row, metric), indexOf(row, metric), indexAvgOf(row, metric), months)}
                  </tr>
                  {childRows(row, metric)}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#6eb5ff]/50">
                <td className="sticky left-0 z-10 bg-[#141922] px-3 py-2 text-left font-semibold text-[#f3f5f9]">Month avg</td>
                {months.map((ym) => {
                  const v = floor[ym];
                  if (v == null) return <td key={ym} />;
                  return (
                    <td
                      key={ym}
                      className="px-2 py-2 text-right font-mono font-semibold"
                      style={styleObject(indexStyle(floorIndex[ym]))}
                      title={indexTitle(ym, v, floorIndex[ym])}
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
              : `Average theoretical and actual daily win through ${through}. Color is the win index against the house average of 1.00. Within 0.02 of 1.00 stays neutral. The lists rank the same six months by theoretical index.`}
        </p>
      </header>

      {leaders ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <LeaderList title="Themes" note="Top 8 · at least 6 unit-months" rows={leaders.themes ?? []} />
          <LeaderList title="Cabinets" note="Top 8 · at least 6 unit-months" rows={leaders.cabinets ?? []} />
          <LeaderList title="Sign themes" note="Themes on one sign" rows={leaders.signs ?? []} />
          <LeaderList title="Regions" note="US Census region from state" rows={leaders.regions ?? []} />
        </div>
      ) : null}

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
    </div>
  );
}
