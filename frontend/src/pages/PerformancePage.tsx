import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { fetchJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type Metric = "tdw" | "adw";

type Measures = {
  tdw: Record<string, number | null>;
  adw: Record<string, number | null>;
  tdw_avg: number | null;
  adw_avg: number | null;
};

type MatrixPayload = {
  performance_month?: string;
  months?: string[];
  casinos?: (Measures & { casino_id: string; casino_name: string })[];
  floor?: { tdw?: Record<string, number | null>; adw?: Record<string, number | null> };
  error?: string;
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

function valueCells(values: Record<string, number | null | undefined>, avg: number | null, months: string[]) {
  return (
    <>
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
          <td
            key={ym}
            className="px-2 py-1.5 text-right font-mono text-[#e8edf5]"
            style={styleObject(trendStyle(v, prev?.value))}
            title={hoverTitle(values, months, i, v)}
          >
            {fmtUsd(v)}
          </td>
        );
      })}
      <td className="px-2 py-1.5 text-right font-mono font-semibold text-[#f3f5f9]">
        {avg != null ? fmtUsd(avg) : ""}
      </td>
    </>
  );
}

export default function PerformancePage() {
  const t = useDashboardTheme();
  const { month } = useDashboardMonth();
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [trees, setTrees] = useState<Record<string, ExpandPayload>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setOpen(new Set());
    setTrees({});
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
          {valueCells(metricOf(vendor, metric), avgOf(vendor, metric), months)}
        </tr>,
      );
      if (!open.has(vk)) continue;
      for (const cabinet of vendor.cabinets) {
        const ck = `${vk}|${cabinet.cabinet}`;
        const canCabinet = cabinet.sign_groups.length + cabinet.themes.length > 0;
        out.push(
          <tr key={ck} className="border-t border-white/5">
            {labelCell(ck, 2, cabinet.cabinet, canCabinet)}
            {valueCells(metricOf(cabinet, metric), avgOf(cabinet, metric), months)}
          </tr>,
        );
        if (!open.has(ck)) continue;
        for (const group of cabinet.sign_groups) {
          const gk = `${ck}|sign:${group.ssm}`;
          const signLabel = group.sign_serial ? `Sign ${group.sign_serial}` : `Sign ${group.ssm}`;
          out.push(
            <tr key={gk} className="border-t border-white/5">
              {labelCell(gk, 3, signLabel, group.themes.length > 0)}
              {valueCells(metricOf(group, metric), avgOf(group, metric), months)}
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
          {valueCells(metricOf(theme, metric), avgOf(theme, metric), months)}
        </tr>,
      );
      if (!open.has(tk)) continue;
      for (const serial of theme.serials) {
        const sk = `${tk}|${serial.slot_master_id || serial.serial}`;
        out.push(
          <tr key={sk} className="border-t border-white/5">
            {labelCell(sk, depth + 1, serial.serial, false)}
            {valueCells(metricOf(serial, metric), avgOf(serial, metric), months)}
          </tr>,
        );
      }
    }
    return out;
  }

  function renderTable(metric: Metric, title: string) {
    const floor = data?.floor?.[metric] ?? {};
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
                    {valueCells(metricOf(row, metric), avgOf(row, metric), months)}
                  </tr>
                  {childRows(row, metric)}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#6eb5ff]/50">
                <td className="sticky left-0 z-10 bg-[#141922] px-3 py-2 text-left font-semibold text-[#f3f5f9]">Month avg</td>
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
              : `Average theoretical and actual daily win through ${through}. Open a casino to expand vendor, cabinet, sign or theme, then serial. Color is versus the prior month. A change under 2% stays neutral.`}
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
    </div>
  );
}
