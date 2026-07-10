import { createContext, useContext, type ReactNode } from "react";

type MonthContextValue = {
  /** YYYY-MM from URL, or empty string for latest available period */
  month: string;
  setMonth: (month: string) => void;
  periods: string[];
};

const MonthContext = createContext<MonthContextValue>({
  month: "",
  setMonth: () => {},
  periods: [],
});

export function DashboardMonthProvider({
  month,
  setMonth,
  periods,
  children,
}: MonthContextValue & { children: ReactNode }) {
  return (
    <MonthContext.Provider value={{ month, setMonth, periods }}>{children}</MonthContext.Provider>
  );
}

export function useDashboardMonth(): MonthContextValue {
  return useContext(MonthContext);
}

/** Append ?month= when a specific period is selected. */
export function withMonthQuery(path: string, month: string): string {
  if (!month) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}month=${encodeURIComponent(month)}`;
}
