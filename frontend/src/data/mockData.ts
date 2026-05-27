/** Mock aggregates shaped like warehouse rollups — swap API responses later. */

export type MonthKey = string;

export type CasinoMonthly = {
  month: MonthKey;
  casino: string;
  tribe: string;
  coinIn: number;
  actualWin: number;
  theoWin: number;
  commission: number;
  avgAdw: number;
  avgTdw: number;
  houseWpu: number;
  cabinetCount: number;
};

export type ThemeMonthly = {
  month: MonthKey;
  casino: string;
  theme: string;
  cabinet: string;
  coinIn: number;
  actualWin: number;
  winIndex: number;
  actualIndex: number;
};

export type SanityFlag = {
  month: MonthKey;
  casino: string;
  flag: string;
  severity: "low" | "med" | "high";
  detail: string;
};

/** Last 14 month-ends */
export const MONTHS: MonthKey[] = [
  "2025-03",
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
];

const CASINOS = [
  { casino: "River Rock Resort", tribe: "Northern Tribe", houseWpu: 285 },
  { casino: "Sunrise Pavilion", tribe: "Desert Nation", houseWpu: 302 },
  { casino: "Lakeside Gaming", tribe: "Lake Band", houseWpu: 268 },
  { casino: "Highland Junction", tribe: "Mountain Tribe", houseWpu: 295 },
  { casino: "Bay Harbor Slots", tribe: "Coastal Nation", houseWpu: 310 },
];

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i);
  return h >>> 0;
}

/** Deterministic pseudo noise for charts */
function noise(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function buildCasinoMonthly(): CasinoMonthly[] {
  const rows: CasinoMonthly[] = [];
  MONTHS.forEach((month, mi) => {
    CASINOS.forEach((c, ci) => {
      const base = 900_000 + ci * 120_000 + mi * 35_000;
      const n = noise(hashSeed(month + c.casino));
      const dip = month === "2025-09" && ci === 1 ? 0.72 : 1;
      const spike = month === "2026-03" && ci === 3 ? 1.35 : 1;
      const coinIn = Math.round(base * dip * spike * (0.92 + n * 0.16));
      const parEff = 11.5 + noise(hashSeed(month + "par" + c.casino)) * 2;
      const actualHold = parEff + (noise(hashSeed(month + "ah" + c.casino)) - 0.45) * 3;
      const actualWin = Math.round((coinIn * actualHold) / 100);
      const theoWin = Math.round((coinIn * parEff) / 100);
      const commission = Math.round(actualWin * (0.17 + noise(hashSeed(month + "com" + c.casino)) * 0.05));
      const cabinetCount = 180 + ci * 22 + Math.round(mi * 1.5);
      const avgAdw = Math.round(actualWin / cabinetCount / 30);
      const avgTdw = Math.round(theoWin / cabinetCount / 30);
      rows.push({
        month,
        casino: c.casino,
        tribe: c.tribe,
        coinIn,
        actualWin,
        theoWin,
        commission,
        avgAdw,
        avgTdw,
        houseWpu: c.houseWpu,
        cabinetCount,
      });
    });
  });
  return rows;
}

export function buildThemeSlices(): ThemeMonthly[] {
  const themes = [
    { theme: "Lightning Links Deluxe", cabinet: "Arc Single" },
    { theme: "Buffalo Ascension", cabinet: "Pod Fusion" },
    { theme: "88 Fortunes Jade", cabinet: "Crystal Curve" },
    { theme: "Wheel Fortune Gold", cabinet: "Pod Fusion" },
    { theme: "Dragon Essence", cabinet: "Arc Single" },
    { theme: "Cleopatra Platinum", cabinet: "Crystal Curve" },
  ];
  const latest = MONTHS[MONTHS.length - 1];
  return CASINOS.flatMap((c, ci) =>
    themes.map((t, ti) => {
      const seed = hashSeed(latest + c.casino + t.theme);
      const coinIn = Math.round((420_000 + ti * 55_000 + ci * 30_000) * (0.85 + noise(seed) * 0.35));
      const actualWin = Math.round((coinIn * (11 + noise(seed + 1) * 4)) / 100);
      const winIndex = Math.round((120 + noise(seed + 2) * 55 - ti * 6 + ci * 4) * 10) / 10;
      const actualIndex = Math.round((118 + noise(seed + 3) * 60 - ti * 5 + ci * 3) * 10) / 10;
      return {
        month: latest,
        casino: c.casino,
        theme: t.theme,
        cabinet: t.cabinet,
        coinIn,
        actualWin,
        winIndex,
        actualIndex,
      };
    }),
  );
}

export function buildSanityFlags(): SanityFlag[] {
  return [
    {
      month: "2026-03",
      casino: "Highland Junction",
      flag: "Actual ≫ Theo",
      severity: "high",
      detail: "Portfolio actual/theo ratio +18% vs trailing 6-mo median.",
    },
    {
      month: "2025-09",
      casino: "Sunrise Pavilion",
      flag: "Coin-in cliff",
      severity: "med",
      detail: "MoM Coin-in −28%; cabinet count unchanged.",
    },
    {
      month: "2026-04",
      casino: "Bay Harbor Slots",
      flag: "Commission profile drift",
      severity: "low",
      detail: "Share of commission IDs 22–24 up 12 pts vs prior quarter.",
    },
  ];
}

export const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100_000 ? 0 : 2,
  }).format(n);
