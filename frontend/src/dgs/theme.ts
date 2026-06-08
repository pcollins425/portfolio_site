/** Visual tokens for dashboards embedded in dgsappv1 (matches assets/dgs.css). */

export type DashboardTheme = "dgs" | "legacy";

export type ChartTheme = {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  commission: string;
  actualWin: string;
  theoWin: string;
  variance: string;
  scatter: string;
  ratio: string;
};

export type ThemeClasses = {
  pageTitle: string;
  pageSub: string;
  panel: string;
  panelLabel: string;
  kpi: string;
  kpiLabel: string;
  kpiValue: string;
  kpiSub: string;
  kpiSubPositive: string;
  tableWrap: string;
  tableHead: string;
  tableRow: string;
  tableCell: string;
  tableCellMuted: string;
  tableCellName: string;
  tableCellBad: string;
  tableCellGood: string;
  calloutGreen: string;
  calloutAmber: string;
  calloutSky: string;
  calloutTitleGreen: string;
  calloutTitleAmber: string;
  calloutTitleSky: string;
  calloutBody: string;
  code: string;
  chart: ChartTheme;
};

export const legacyTheme: ThemeClasses = {
  pageTitle: "text-lg font-semibold text-white",
  pageSub: "mt-1 text-sm text-slate-400",
  panel: "rounded-xl border border-slate-800 bg-slate-900/40 p-4",
  panelLabel: "text-xs font-medium uppercase tracking-wide text-slate-500",
  kpi: "rounded-xl border border-slate-800 bg-slate-900/50 p-5",
  kpiLabel: "text-xs font-medium uppercase tracking-wide text-slate-500",
  kpiValue: "mt-2 text-2xl font-semibold tracking-tight text-white",
  kpiSub: "mt-1 text-sm text-emerald-400/90",
  kpiSubPositive: "mt-1 text-sm text-emerald-400/90",
  tableWrap: "overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40",
  tableHead: "border-b border-slate-800 bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500",
  tableRow: "divide-y divide-slate-800",
  tableCell: "px-4 py-3 font-mono text-slate-300",
  tableCellMuted: "px-4 py-3 font-mono text-slate-400",
  tableCellName: "px-4 py-3 font-medium text-white",
  tableCellBad: "text-rose-400",
  tableCellGood: "text-emerald-400",
  calloutGreen: "rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4",
  calloutAmber: "rounded-xl border border-amber-500/25 bg-amber-500/5 p-4",
  calloutSky: "rounded-xl border border-sky-500/25 bg-sky-500/5 p-4",
  calloutTitleGreen: "text-xs font-semibold uppercase tracking-wide text-emerald-300",
  calloutTitleAmber: "text-xs font-semibold uppercase tracking-wide text-amber-200",
  calloutTitleSky: "text-xs font-semibold uppercase tracking-wide text-sky-200",
  calloutBody: "mt-2 text-sm text-slate-300",
  code: "text-slate-400",
  chart: {
    grid: "#334155",
    axis: "#94a3b8",
    tooltipBg: "#0f172a",
    tooltipBorder: "#334155",
    commission: "#34d399",
    actualWin: "#34d399",
    theoWin: "#818cf8",
    variance: "#fbbf24",
    scatter: "#38bdf8",
    ratio: "#a78bfa",
  },
};

export const dgsTheme: ThemeClasses = {
  pageTitle: "text-lg font-semibold text-[#1e293b]",
  pageSub: "mt-1 text-sm text-[#64748b]",
  panel:
    "rounded-2xl border border-[#d6e4ea] bg-white p-4 shadow-[0_4px_18px_rgba(100,130,150,0.08)]",
  panelLabel: "text-xs font-medium uppercase tracking-wide text-[#64748b]",
  kpi:
    "rounded-2xl border border-[#d6e4ea] bg-white p-5 shadow-[0_4px_18px_rgba(100,130,150,0.08)]",
  kpiLabel: "text-xs font-medium uppercase tracking-wide text-[#64748b]",
  kpiValue: "mt-2 text-2xl font-semibold tracking-tight text-[#1e293b]",
  kpiSub: "mt-1 text-sm text-[#64748b]",
  kpiSubPositive: "mt-1 text-sm text-[#15803d]",
  tableWrap:
    "overflow-hidden rounded-2xl border border-[#d6e4ea] bg-white shadow-[0_4px_18px_rgba(100,130,150,0.08)]",
  tableHead:
    "border-b border-[#d6e4ea] bg-[#f8fafb] text-xs uppercase tracking-wide text-[#64748b]",
  tableRow: "divide-y divide-[#d6e4ea]",
  tableCell: "px-4 py-3 font-mono text-[#475569]",
  tableCellMuted: "px-4 py-3 font-mono text-[#64748b]",
  tableCellName: "px-4 py-3 font-medium text-[#1e293b]",
  tableCellBad: "text-[#dc2626]",
  tableCellGood: "text-[#15803d]",
  calloutGreen: "rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] p-4",
  calloutAmber: "rounded-2xl border border-[#fde68a] bg-[#fffbeb] p-4",
  calloutSky: "rounded-2xl border border-[#bae6fd] bg-[#f0f9ff] p-4",
  calloutTitleGreen: "text-xs font-semibold uppercase tracking-wide text-[#15803d]",
  calloutTitleAmber: "text-xs font-semibold uppercase tracking-wide text-[#b45309]",
  calloutTitleSky: "text-xs font-semibold uppercase tracking-wide text-[#0369a1]",
  calloutBody: "mt-2 text-sm text-[#475569]",
  code: "text-[#64748b]",
  chart: {
    grid: "#d6e4ea",
    axis: "#64748b",
    tooltipBg: "#ffffff",
    tooltipBorder: "#d6e4ea",
    commission: "#5a85d6",
    actualWin: "#5a85d6",
    theoWin: "#64748b",
    variance: "#e8734a",
    scatter: "#5a85d6",
    ratio: "#e8734a",
  },
};

export function themeFor(mode: DashboardTheme): ThemeClasses {
  return mode === "dgs" ? dgsTheme : legacyTheme;
}
