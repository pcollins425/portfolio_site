import { useEffect, useState } from "react";
import { fetchJson } from "../api/client";
import { withMonthQuery } from "../dgs/MonthContext";

export type CompareSeed = {
  token: number;
  split: string;
  id: string;
  label: string;
};

type SplitOption = { id: string; label: string };
type ValueOption = { id: string; label: string; unit_months: number };
type Side = {
  id: string;
  label: string;
  theo_index: number | null;
  units: number;
  unit_months: number;
  thin: boolean;
  note?: string | null;
};
type ComparePayload = { sides?: Side[]; floor?: number; error?: string };
type MemberSerial = {
  serial: string;
  theme: string;
  cabinet: string;
  unit_months: number;
  theo_index: number | null;
};
type MemberHouse = { casino_id: string; casino_name: string; serials: MemberSerial[] };
type MembersPayload = { casinos?: MemberHouse[]; truncated?: boolean; label?: string };

const DEFAULT_SPLITS: SplitOption[] = [
  { id: "theme", label: "Theme" },
  { id: "cabinet", label: "Cabinet" },
  { id: "vendor", label: "Vendor" },
  { id: "casino", label: "Casino" },
  { id: "region", label: "Region" },
  { id: "sign", label: "Sign" },
  { id: "sign_bank", label: "Sign bank" },
  { id: "denom", label: "Denom" },
];

const FIELD =
  "rounded-lg border border-white/10 bg-[#141922] px-2 py-1.5 text-sm text-[#f3f5f9] outline-none focus:border-[#6eb5ff]/40";

const FIXED_LABELS: Record<string, Record<string, string>> = {
  sign: { with: "With a sign", without: "Without a sign" },
  denom: { single: "Single denom", multi: "Multi denom" },
};

function indexStyle(index: number | null | undefined): string {
  if (index == null) return "";
  const delta = index - 1;
  if (Math.abs(delta) < 0.02) return "";
  const mag = Math.min(1, Math.abs(delta) / 0.25);
  const alpha = (0.12 + mag * 0.38).toFixed(2);
  if (delta > 0) return `background-color: rgba(34, 197, 94, ${alpha}); color: #d1fae5;`;
  return `background-color: rgba(239, 68, 68, ${alpha}); color: #fecaca;`;
}

function styleObject(css: string): Record<string, string> {
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

function optionLabel(value: ValueOption) {
  return `${value.label} (${value.unit_months.toLocaleString()})`;
}

export default function CompareSets({ month, seed }: { month: string; seed: CompareSeed | null }) {
  const [splits, setSplits] = useState<SplitOption[]>(DEFAULT_SPLITS);
  const [split, setSplit] = useState("theme");
  const [hold, setHold] = useState("");
  const [holdValue, setHoldValue] = useState("");
  const [sideA, setSideA] = useState("");
  const [sideB, setSideB] = useState("");
  const [splitValues, setSplitValues] = useState<ValueOption[]>([]);
  const [valueKey, setValueKey] = useState("");
  const [holdValues, setHoldValues] = useState<ValueOption[]>([]);
  const [result, setResult] = useState<ComparePayload | null>(null);
  const [members, setMembers] = useState<MembersPayload | null>(null);
  const [openSide, setOpenSide] = useState<0 | 1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<CompareSeed | null>(null);

  useEffect(() => {
    fetchJson<{ splits?: SplitOption[] }>("/api/performance/compare/splits")
      .then((payload) => setSplits(payload.splits ?? []))
      .catch(() => setSplits(DEFAULT_SPLITS));
  }, []);

  useEffect(() => {
    if (!seed) return;
    setSplit(seed.split);
    setHold("");
    setHoldValue("");
    setSideA("");
    setSideB("");
    setResult(null);
    setMembers(null);
    setOpenSide(null);
    setErr(null);
    setPending(seed);
  }, [seed]);

  useEffect(() => {
    if (!hold) {
      setHoldValues([]);
      return;
    }
    let dead = false;
    fetchJson<{ values?: ValueOption[] }>(
      withMonthQuery(`/api/performance/compare/values?split=${encodeURIComponent(hold)}`, month),
    )
      .then((payload) => {
        if (!dead) setHoldValues(payload.values ?? []);
      })
      .catch(() => {
        if (!dead) setHoldValues([]);
      });
    return () => {
      dead = true;
    };
  }, [hold, month]);

  useEffect(() => {
    if (hold && !holdValue) {
      setSplitValues([]);
      return;
    }
    const params = new URLSearchParams({ split });
    if (hold && holdValue) {
      params.set("hold", hold);
      params.set("hold_value", holdValue);
    }
    const key = params.toString();
    let dead = false;
    fetchJson<{ values?: ValueOption[] }>(
      withMonthQuery(`/api/performance/compare/values?${params.toString()}`, month),
    )
      .then((payload) => {
        if (!dead) {
          setSplitValues(payload.values ?? []);
          setValueKey(key);
        }
      })
      .catch(() => {
        if (!dead) {
          setSplitValues([]);
          setValueKey(key);
        }
      });
    return () => {
      dead = true;
    };
  }, [split, hold, holdValue, month]);

  useEffect(() => {
    if (!pending || pending.split !== split) return;
    const params = new URLSearchParams({ split });
    if (hold && holdValue) {
      params.set("hold", hold);
      params.set("hold_value", holdValue);
    }
    if (hold && !holdValue) return;
    if (valueKey !== params.toString()) return;
    const hit = splitValues.find((value) => value.id === pending.id || value.label === pending.label);
    if (hit) setSideA(hit.id);
    setPending(null);
  }, [pending, split, splitValues, hold, holdValue, valueKey]);

  function changeSplit(next: string) {
    setSplit(next);
    setSideA("");
    setSideB("");
    setResult(null);
    setMembers(null);
    setOpenSide(null);
    if (hold === next) {
      setHold("");
      setHoldValue("");
    }
  }

  function applySetup(next: string) {
    setResult(null);
    setMembers(null);
    setOpenSide(null);
    setErr(null);
    setPending(null);
    if (next === "sign-theme") {
      setSplit("sign");
      setSideA("with");
      setSideB("without");
      setHold("theme");
      setHoldValue("");
    } else if (next === "denom-theme") {
      setSplit("denom");
      setSideA("single");
      setSideB("multi");
      setHold("theme");
      setHoldValue("");
    }
  }

  function valuesFor(selected: string): ValueOption[] {
    if (selected && !splitValues.some((value) => value.id === selected)) {
      const label = FIXED_LABELS[split]?.[selected] ?? selected;
      return [{ id: selected, label, unit_months: 0 }, ...splitValues];
    }
    return splitValues;
  }

  const ready = Boolean(sideA && sideB && sideA !== sideB && (!hold || holdValue));

  async function run() {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    setMembers(null);
    setOpenSide(null);
    const params = new URLSearchParams({ split, side_a: sideA, side_b: sideB });
    if (hold && holdValue) {
      params.set("hold", hold);
      params.set("hold_value", holdValue);
    }
    try {
      const payload = await fetchJson<ComparePayload>(
        withMonthQuery(`/api/performance/compare?${params.toString()}`, month),
      );
      setResult(payload);
    } catch (error) {
      setResult(null);
      setErr(error instanceof Error ? error.message : "Compare failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMembers(index: 0 | 1) {
    if (!result?.sides?.[index]) return;
    if (openSide === index) {
      setOpenSide(null);
      setMembers(null);
      return;
    }
    setOpenSide(index);
    setMembers(null);
    const params = new URLSearchParams({ split, value: result.sides[index].id });
    if (hold && holdValue) {
      params.set("hold", hold);
      params.set("hold_value", holdValue);
    }
    try {
      const payload = await fetchJson<MembersPayload>(
        withMonthQuery(`/api/performance/compare/members?${params.toString()}`, month),
      );
      setMembers(payload);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not list that side.");
    }
  }

  const holdChoices = splits.filter((item) => item.id !== split);

  return (
    <section className="rounded-xl border border-white/10 bg-[#141922] p-3">
      <h3 className="text-sm font-semibold text-[#9ecbff]">Compare</h3>
      <p className="mb-3 max-w-3xl text-[11px] text-[#8b96a8]">
        Same six months and theoretical index as the lists. Pick any split and two sides. A hold keeps another
        attribute the same on both. A common setup only fills these controls.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-[#8b96a8]">
          Common setup
          <select className={FIELD} value="" onChange={(event) => applySetup(event.target.value)}>
            <option value="">Fill controls…</option>
            <option value="sign-theme">Sign vs no sign, same theme</option>
            <option value="denom-theme">Single vs multi denom, same theme</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[#8b96a8]">
          Split
          <select className={FIELD} value={split} onChange={(event) => changeSplit(event.target.value)}>
            {splits.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[#8b96a8]">
          Side A
          <select className={FIELD} value={sideA} onChange={(event) => setSideA(event.target.value)}>
            <option value="">Choose…</option>
            {valuesFor(sideA).map((value) => (
              <option key={value.id} value={value.id}>
                {optionLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[#8b96a8]">
          Side B
          <select className={FIELD} value={sideB} onChange={(event) => setSideB(event.target.value)}>
            <option value="">Choose…</option>
            {valuesFor(sideB).map((value) => (
              <option key={value.id} value={value.id}>
                {optionLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[#8b96a8]">
          Hold
          <select
            className={FIELD}
            value={hold}
            onChange={(event) => {
              setHold(event.target.value);
              setHoldValue("");
              setResult(null);
            }}
          >
            <option value="">None</option>
            {holdChoices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {hold ? (
          <label className="flex flex-col gap-1 text-[11px] text-[#8b96a8]">
            Hold value
            <select
              className={FIELD}
              value={holdValue}
              onChange={(event) => {
                setHoldValue(event.target.value);
                setResult(null);
              }}
            >
              <option value="">Choose…</option>
              {holdValues.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void run()}
          className="rounded-lg bg-[#6eb5ff]/20 px-3 py-1.5 text-sm text-[#9ecbff] disabled:opacity-40"
        >
          {busy ? "Comparing…" : "Compare"}
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-[#fecaca]">{err}</p> : null}
      {result?.sides?.length === 2 ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {result.sides.map((side, index) => (
            <div key={`${side.id}-${index}`} className="rounded-lg border border-white/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-[#f3f5f9]">{side.label}</p>
                  <p className="text-[11px] text-[#8b96a8]">
                    {side.units.toLocaleString()} units · {side.unit_months.toLocaleString()} unit-months
                  </p>
                  {side.note ? <p className="mt-1 text-[11px] text-[#8b96a8]">{side.note}</p> : null}
                </div>
                <span
                  className="rounded px-1.5 py-0.5 font-mono text-sm"
                  style={styleObject(indexStyle(side.theo_index))}
                >
                  {side.theo_index == null ? "—" : side.theo_index.toFixed(2)}
                </span>
              </div>
              <button
                type="button"
                className="mt-2 text-[11px] text-[#9ecbff]"
                onClick={() => void toggleMembers(index as 0 | 1)}
              >
                {openSide === index ? "Hide casinos and serials" : "Casinos and serials"}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {openSide != null && members ? (
        <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-white/10">
          {members.truncated ? (
            <p className="px-3 py-2 text-[11px] text-[#8b96a8]">Showing the first 500 serials.</p>
          ) : null}
          {(members.casinos ?? []).length === 0 ? (
            <p className="px-3 py-2 text-xs text-[#5c6778]">No serials in this side.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {(members.casinos ?? []).map((house) => (
                <li key={house.casino_id} className="px-3 py-2">
                  <p className="text-sm text-[#f3f5f9]">{house.casino_name}</p>
                  <ul className="mt-1 space-y-0.5">
                    {house.serials.map((serial) => (
                      <li
                        key={`${house.casino_id}-${serial.serial}`}
                        className="flex justify-between gap-3 text-[11px] text-[#8b96a8]"
                      >
                        <span className="font-mono text-[#f3f5f9]">{serial.serial}</span>
                        <span className="min-w-0 truncate">
                          {serial.theme}
                          {serial.cabinet ? ` · ${serial.cabinet}` : ""}
                        </span>
                        <span className="shrink-0 font-mono">
                          {serial.theo_index == null ? "—" : serial.theo_index.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
