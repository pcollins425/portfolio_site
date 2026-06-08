import React from "react";
import ReactDOM from "react-dom/client";
import DashboardApp from "./dgs/DashboardApp";
import { DashboardThemeProvider } from "./dgs/ThemeContext";
import "./index.css";

const rootEl = document.getElementById("dashboard-root");
if (!rootEl) {
  throw new Error("Missing #dashboard-root — mount dashboards from dgsappv1/dashboard.html");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <DashboardThemeProvider mode="dgs">
      <DashboardApp />
    </DashboardThemeProvider>
  </React.StrictMode>,
);
