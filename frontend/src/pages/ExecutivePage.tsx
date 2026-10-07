import { useEffect, useRef, useState } from "react";
import { fetchJson } from "../api/client";
import { useDashboardMonth, withMonthQuery } from "../dgs/MonthContext";
import { useDashboardTheme } from "../dgs/ThemeContext";
import { fmtUsd } from "../data/mockData";

type MonthSeriesRow = {
  month: string;
  projects: { open: number; closed: number };
  deals: { created: number; won: number; closed: number };
  placements: { machines: number; delta: number };
  footprint: {
    changed: number;
    converts: number;
    swaps: number;
    active: number;
    pct: number;
  };
  leased_clients: number;
  reporting: { reported: number; expected: number; pct: number };
};

type ExecutivePayload = {
  source: string;
  error?: string;
  latest?: string;
  prev?: string;
  window_months?: number;
  series_source?: string;
  coinIn?: number;
  coinInMom?: number;
  actualWin?: number;
  actualMom?: number;
  commission?: number;
  commissionMom?: number;
  series?: MonthSeriesRow[];
};

function fmtMom(v: number) {
  return `MoM ${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function fmtDelta(n: number) {
  return `${n >= 0 ? "+" : ""}${n}`;
}

function fmtMonthLabel(iso: string) {
  if (!iso || iso.length < 7) return iso || "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

const COLUMN_HELP: { label: string; text: string }[] = [
  {
    label: "Projects",
    text: "Open jobs still cover month-end. Closed jobs finished during the month. A job with no dates is left out. The cell is open, then closed.",
  },
  {
    label: "Deals",
    text: "Deals opened during the month, then deals won, then deals lost. Won and lost follow the close date.",
  },
  {
    label: "Machines / Δ",
    text: "Playable machines on the floor at month-end. The change is against the prior month-end. A conversion or swap does not add a machine.",
  },
  {
    label: "Footprint Δ %",
    text: "Share of the floor that changed: conversions plus swaps, divided by machines on the floor. Moves are not included. The detail is conversions, swaps, and the floor count.",
  },
  {
    label: "Clients",
    text: "Properties with playable machines on the floor at month-end.",
  },
  {
    label: "Reporting %",
    text: "Properties that turned in a report, out of the properties expected to bill. The detail is reported over expected.",
  },
];

function helpFor(label: string) {
  return COLUMN_HELP.find((item) => item.label === label)?.text ?? "";
}

function HeaderTip({
  label,
  text,
  hideLabel = false,
}: {
  label: string;
  text: string;
  hideLabel?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 256;
    const margin = 12;
    const center = rect.left + rect.width / 2;
    const left = Math.max(
      margin + width / 2,
      Math.min(center, window.innerWidth - margin - width / 2),
    );
    setPos({ top: rect.bottom + 8, left });
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (btnRef.current?.contains(event.target as Node)) return;
      pinned.current = false;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <span className="inline-flex items-center gap-1.5">
      {hideLabel ? null : label}
      <button
        ref={btnRef}
        type="button"
        aria-label={`How ${label} is calculated`}
        aria-expanded={open}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current/30 text-[10px] font-semibold normal-case leading-none opacity-70 hover:opacity-100"
        onMouseEnter={() => {
          place();
          setOpen(true);
        }}
        onMouseLeave={() => {
          if (!pinned.current) setOpen(false);
        }}
        onFocus={() => {
          place();
          setOpen(true);
        }}
        onBlur={() => {
          if (!pinned.current) setOpen(false);
        }}
        onClick={() => {
          if (pinned.current) {
            pinned.current = false;
            setOpen(false);
            return;
          }
          pinned.current = true;
          place();
          setOpen(true);
        }}
      >
        ?
      </button>
      {open && pos ? (
        <span
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-50 w-64 -translate-x-1/2 rounded-lg border border-white/10 bg-[#0e1218] px-3 py-2 text-left text-[13px] font-normal normal-case leading-snug tracking-normal text-[#c5cdd9] shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

function Kpi({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  const t = useDashboardTheme();
  return (
    <div className={t.kpi}>
      <p className={t.kpiLabel}>{label}</p>
      <p className={t.kpiValue}>{value}</p>
      <p className={positive === false ? t.kpiSub : t.kpiSubPositive}>{sub}</p>
    </div>
  );
}

function MonthCard({ row }: { row: MonthSeriesRow }) {
  const t = useDashboardTheme();
  return (
    <article className={`rounded-xl border border-white/10 bg-[#141922] p-3 ${t.code}`}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#f3f5f9]">{fmtMonthLabel(row.month)}</h3>
        <span className="text-xs text-[#8b96a8]">
          {row.reporting.pct.toFixed(0)}% reporting ({row.reporting.reported}/
          {row.reporting.expected})
          <span className="ml-1 inline-flex align-middle">
            <HeaderTip label="Reporting %" text={helpFor("Reporting %")} hideLabel />
          </span>
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-[#8b96a8]">
            <HeaderTip label="Projects" text={helpFor("Projects")} />
          </dt>
          <dd className="font-mono text-[#c5cdd9]">
            {row.projects.open} open / {row.projects.closed} closed
          </dd>
        </div>
        <div>
          <dt className="text-[#8b96a8]">
            <HeaderTip label="Deals" text={helpFor("Deals")} />
          </dt>
          <dd className="font-mono text-[#c5cdd9]">
            {row.deals.created} / {row.deals.won} / {row.deals.closed}
          </dd>
        </div>
        <div>
          <dt className="text-[#8b96a8]">
            <HeaderTip label="Machines / Δ" text={helpFor("Machines / Δ")} />
          </dt>
          <dd className="font-mono text-[#c5cdd9]">
            {row.placements.machines.toLocaleString()} ({fmtDelta(row.placements.delta)})
          </dd>
        </div>
        <div>
          <dt className="text-[#8b96a8]">
            <HeaderTip label="Footprint Δ %" text={helpFor("Footprint Δ %")} />
          </dt>
          <dd className="font-mono text-[#c5cdd9]">
            {row.footprint.pct.toFixed(2)}% ({row.footprint.converts}c+{row.footprint.swaps}s)
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[#8b96a8]">
            <HeaderTip label="Clients" text={helpFor("Clients")} />
          </dt>
          <dd className="font-mono text-[#c5cdd9]">{row.leased_clients}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function ExecutivePage() {
  const t = useDashboardTheme();
  const { month, periods, setMonth } = useDashboardMonth();
  const [data, setData] = useState<ExecutivePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    fetchJson<ExecutivePayload>(withMonthQuery("/api/executive", month))
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

  const windowMonths = data?.window_months ?? 12;
  const coinIn = data?.coinIn ?? 0;
  const coinInMom = data?.coinInMom ?? 0;
  const actualWin = data?.actualWin ?? 0;
  const actualMom = data?.actualMom ?? 0;
  const commission = data?.commission ?? 0;
  const commissionMom = data?.commissionMom ?? 0;
  const series = [...(data?.series ?? [])].reverse(); // newest first for table

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={t.pageTitle}>Executive Overview</h2>
        {periods.length ? (
          <label className={`inline-flex items-center gap-2 text-sm ${t.code}`}>
            <span className="font-medium">Period</span>
            <select
              value={month || periods[0]?.slice(0, 7) || ""}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#141922] px-2.5 py-1.5 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40"
            >
              {periods.map((p) => {
                const ym = p.slice(0, 7);
                return (
                  <option key={p} value={ym}>
                    {ym}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
      </header>
      {err ? <p className={t.pageSub}>Couldn’t load this overview.</p> : null}

      {!err && (
        <>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 sm:gap-4">
            <Kpi
              label="Coin-in"
              value={fmtUsd(coinIn)}
              sub={fmtMom(coinInMom)}
              positive={coinInMom >= 0}
            />
            <Kpi
              label="Actual win"
              value={fmtUsd(actualWin)}
              sub={fmtMom(actualMom)}
              positive={actualMom >= 0}
            />
            <Kpi
              label="Commission"
              value={fmtUsd(commission)}
              sub={fmtMom(commissionMom)}
              positive={commissionMom >= 0}
            />
          </div>

          <div className={t.panel}>
            <p className={t.panelLabel}>
              Ops pulse — trailing {windowMonths} months (newest first)
            </p>

            {/* Phone: stacked month cards */}
            <div className="mt-3 space-y-3 md:hidden">
              {series.map((row) => (
                <MonthCard key={row.month} row={row} />
              ))}
              {!series.length && !loading && (
                <p className={`${t.tableCellMuted} px-1 py-4`}>No series rows returned.</p>
              )}
            </div>

            {/* Tablet/desktop: scrollable wide table */}
            <div className="mt-4 hidden md:block">
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-[720px] w-full text-left text-sm">
                  <thead className={t.tableHead}>
                    <tr>
                      <th className="px-3 py-2.5 whitespace-nowrap">Month</th>
                      {COLUMN_HELP.map((col) => (
                        <th key={col.label} className="px-3 py-2.5 whitespace-nowrap">
                          <HeaderTip label={col.label} text={col.text} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={t.tableRow}>
                    {series.map((row) => (
                      <tr key={row.month}>
                        <td className={t.tableCellName}>{fmtMonthLabel(row.month)}</td>
                        <td className={t.tableCell}>
                          {row.projects.open} / {row.projects.closed}
                        </td>
                        <td className={t.tableCell}>
                          {row.deals.created} / {row.deals.won} / {row.deals.closed}
                        </td>
                        <td className={t.tableCell}>
                          {row.placements.machines.toLocaleString()}
                          <span className="ml-1 text-xs opacity-70">
                            ({fmtDelta(row.placements.delta)})
                          </span>
                        </td>
                        <td className={t.tableCell}>
                          {row.footprint.pct.toFixed(2)}%
                          <span className="ml-1 text-xs opacity-70">
                            ({row.footprint.converts}c+{row.footprint.swaps}s /{" "}
                            {row.footprint.active.toLocaleString()})
                          </span>
                        </td>
                        <td className={t.tableCell}>{row.leased_clients}</td>
                        <td className={t.tableCell}>
                          {row.reporting.pct.toFixed(1)}%
                          <span className="ml-1 text-xs opacity-70">
                            ({row.reporting.reported}/{row.reporting.expected})
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!series.length && !loading && (
                      <tr>
                        <td className={t.tableCellMuted} colSpan={7}>
                          No series rows returned.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
