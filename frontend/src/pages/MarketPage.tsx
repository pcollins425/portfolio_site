import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchJson } from "../api/client";
import { useDashboardTheme } from "../dgs/ThemeContext";

type NamedUnits = { name: string; units: number };
type Leader = { casino: string; units: number; floor: number; share_pct: number };

type MarketPayload = {
  units: number;
  casinos_with_units: number;
  contracted_markets: number;
  penetrated_markets: number;
  open_markets: number;
  penetration_pct: number;
  floor_casinos: number;
  floor_units: number;
  floor_size: number;
  blended_share_pct: number;
  excluded_universal: string[];
  leaders: Leader[];
  vendors: NamedUnits[];
  cabinets: NamedUnits[];
};

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  const t = useDashboardTheme();
  return (
    <div className={t.kpi}>
      <p className={t.kpiLabel}>{label}</p>
      <p className={t.kpiValue}>{value}</p>
      <p className={t.kpiSub}>{sub}</p>
    </div>
  );
}

function RankChart({
  title,
  rows,
  dataKey,
  color,
  tickFormatter,
  tooltip,
}: {
  title: string;
  rows: Record<string, string | number>[];
  dataKey: string;
  color: string;
  tickFormatter?: (value: number) => string;
  tooltip: (row: Record<string, string | number>) => string;
}) {
  const t = useDashboardTheme();
  const chartRows = [...rows].reverse();
  return (
    <div className={t.panel}>
      <p className={t.panelLabel}>{title}</p>
      <div className="mt-4 h-80">
        {chartRows.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} layout="vertical" margin={{ left: 8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.chart.grid} horizontal={false} />
              <XAxis
                type="number"
                stroke={t.chart.axis}
                tick={{ fontSize: 11 }}
                tickFormatter={tickFormatter}
              />
              <YAxis
                type="category"
                dataKey="label"
                stroke={t.chart.axis}
                width={148}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                formatter={(value: number) => [tickFormatter ? tickFormatter(value) : value, title]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as Record<string, string | number> | undefined;
                  return row ? tooltip(row) : "";
                }}
              />
              <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className={`text-sm ${t.code}`}>Nothing to chart.</p>
        )}
      </div>
    </div>
  );
}

export default function MarketPage() {
  const t = useDashboardTheme();
  const [data, setData] = useState<MarketPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<MarketPayload>("/api/market/overview")
      .then((payload) => {
        setData(payload);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <section>
        <h2 className={t.pageTitle}>Market</h2>
        <p className={t.pageSub}>Floor snapshot unavailable ({err}).</p>
      </section>
    );
  }
  if (!data) {
    return <p className={`text-sm ${t.code}`}>Loading floor…</p>;
  }

  const donut = [
    { name: "Penetrated", value: data.penetrated_markets },
    { name: "Open", value: data.open_markets },
  ];
  const universal = data.excluded_universal.join(", ");

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className={t.panel}>
          <p className={t.panelLabel}>Contracted markets</p>
          <div className="relative mt-2 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donut}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={82}
                  stroke="none"
                  paddingAngle={2}
                >
                  <Cell fill="#6eb5ff" />
                  <Cell fill="rgba(255,255,255,0.14)" />
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: t.chart.tooltipBg, borderColor: t.chart.tooltipBorder }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold tracking-tight text-[#f3f5f9]">
                {data.penetration_pct.toFixed(0)}%
              </span>
              <span className="text-xs text-[#8b96a8]">penetrated</span>
            </div>
          </div>
        </div>

        <div>
          <h2 className={t.pageTitle}>Market</h2>
          <p className={`max-w-3xl ${t.pageSub}`}>
            {data.units.toLocaleString()} machines are on the floor at{" "}
            {data.casinos_with_units.toLocaleString()} casinos.{" "}
            {data.penetrated_markets.toLocaleString()} of{" "}
            {data.contracted_markets.toLocaleString()} contracted vendor markets have at least
            one of them. Where a house floor size is on file, those machines are{" "}
            {data.blended_share_pct.toFixed(1)}% of the floor.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi
              label="Contracted"
              value={data.contracted_markets.toLocaleString()}
              sub="Casino × vendor agreements"
            />
            <Kpi
              label="Penetrated"
              value={data.penetrated_markets.toLocaleString()}
              sub="Agreement with a machine on the floor"
            />
            <Kpi
              label="Open"
              value={data.open_markets.toLocaleString()}
              sub="Agreement, no machine yet"
            />
            <Kpi
              label="Units on floor"
              value={data.units.toLocaleString()}
              sub={`${data.casinos_with_units.toLocaleString()} casinos`}
            />
            <Kpi
              label="Floor share"
              value={`${data.blended_share_pct.toFixed(1)}%`}
              sub={`${data.floor_units.toLocaleString()} of ${data.floor_size.toLocaleString()} at ${data.floor_casinos} houses`}
            />
          </div>
          <p className={`mt-3 text-xs ${t.code}`}>
            Active Slot Master stints, joined to the asset. Cabinet type Center, Sign, Controller, and Server are left out.{" "}
            {universal} stay off the agreement count. Floor share uses{" "}
            <span className="font-mono">total_number_of_machines</span> and only houses that
            have both a size and our machines.
          </p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <RankChart
          title="Floor share leaders"
          color="#34d399"
          dataKey="share"
          tickFormatter={(value) => `${value}%`}
          rows={data.leaders.map((row) => ({
            label: row.casino,
            share: row.share_pct,
            units: row.units,
            floor: row.floor,
          }))}
          tooltip={(row) =>
            `${row.label} · ${Number(row.units).toLocaleString()} of ${Number(row.floor).toLocaleString()}`
          }
        />
        <RankChart
          title="Vendor portfolio"
          color="#6eb5ff"
          dataKey="units"
          rows={data.vendors.map((row) => ({ label: row.name, units: row.units }))}
          tooltip={(row) => `${row.label} · ${Number(row.units).toLocaleString()} machines`}
        />
        <RankChart
          title="Cabinet mix"
          color="#a78bfa"
          dataKey="units"
          rows={data.cabinets.map((row) => ({ label: row.name, units: row.units }))}
          tooltip={(row) => `${row.label} · ${Number(row.units).toLocaleString()} machines`}
        />
      </section>
    </div>
  );
}
