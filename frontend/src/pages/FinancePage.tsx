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
  const [scatter, setScatter] = useState<CasinoRow[]>([]);
  const [ratios, setRatios] = useState<RatioRow[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJson<CasinosPayload>("/api/finance/casinos-latest"),
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
  }, []);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-white">Economics & viability</h2>
        <p className="mt-1 text-sm text-slate-400">
          {err
            ? `Live slice unavailable (${err}). Run backend_local (python run.py) beside npm run dev.`
            : `Average daily actual vs house benchmark. Commission÷actual (${asOf.replace(/T.+/, "") || "latest month"} slice).`}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            ADW vs house benchmark ({asOf.slice(0, 10) || "—"})
          </p>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" dataKey="houseWpu" name="House benchmark" stroke="#94a3b8" domain={["dataMin - 10", "dataMax + 10"]} />
                <YAxis type="number" dataKey="avgAdw" name="Avg ADW" stroke="#94a3b8" />
                <ZAxis range={[80, 80]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                  formatter={(value: unknown, name: string) =>
                    [typeof value === "number" ? Math.round(value) : String(value), name]
                  }
                  labelFormatter={(_, payload) =>
                    payload?.length ? String((payload[0] as { payload?: { casino?: string } }).payload?.casino ?? "") : ""
                  }
                />
                <Scatter name="Casinos" data={scatter} fill="#38bdf8" shape="circle" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Interpret with commission profile mix — aggregates are AVG(ADW)/AVG(HouseWPU) by casino row grain.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Commission ÷ actual win (national)
          </p>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ratios}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={52} />
                <YAxis stroke="#94a3b8" domain={[0, "auto"]} tickFormatter={(v) => `${(v * 100).toFixed(0)}¢/$`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                  formatter={(value: number) => [`${(value * 100).toFixed(1)}¢ per $ actual`, "Ratio"]}
                />
                <Legend />
                <Line type="stepAfter" dataKey="ratio" name="Commission intensity" stroke="#a78bfa" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Casino</th>
              <th className="px-4 py-3 font-medium">Avg ADW</th>
              <th className="px-4 py-3 font-medium">House benchmark</th>
              <th className="px-4 py-3 font-medium">Gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {scatter.map((r) => (
              <tr key={r.casino + r.avgAdw} className={r.delta < 0 ? "bg-rose-500/5" : ""}>
                <td className="px-4 py-3 font-medium text-white">{r.casino}</td>
                <td className="px-4 py-3 font-mono text-slate-300">${r.avgAdw}</td>
                <td className="px-4 py-3 font-mono text-slate-400">${r.houseWpu}</td>
                <td className={`px-4 py-3 font-mono ${r.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
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
