import { createContext, useContext, type ReactNode } from "react";
import { dgsTheme, dgsV2Theme, legacyTheme, type ThemeClasses } from "./theme";

const ThemeContext = createContext<ThemeClasses>(dgsV2Theme);

export function DashboardThemeProvider({
  mode,
  children,
}: {
  mode: "dgs" | "legacy" | "v2";
  children: ReactNode;
}) {
  const value = mode === "v2" ? dgsV2Theme : mode === "dgs" ? dgsTheme : legacyTheme;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useDashboardTheme(): ThemeClasses {
  return useContext(ThemeContext);
}
