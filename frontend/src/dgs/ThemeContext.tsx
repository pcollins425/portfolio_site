import { createContext, useContext, type ReactNode } from "react";
import { dgsTheme, legacyTheme, type ThemeClasses } from "./theme";

const ThemeContext = createContext<ThemeClasses>(legacyTheme);

export function DashboardThemeProvider({
  mode,
  children,
}: {
  mode: "dgs" | "legacy";
  children: ReactNode;
}) {
  const value = mode === "dgs" ? dgsTheme : legacyTheme;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useDashboardTheme(): ThemeClasses {
  return useContext(ThemeContext);
}
