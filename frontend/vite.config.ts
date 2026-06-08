import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Production Pages URL: **`https://www.collinsmediallc.com/dashboardtestv1/`** — keep in sync with router + publish script). */
export const DASHBOARD_BASE = "/dashboardtestv1/";
export const DGS_APP_DASHBOARD_BASE = "/dgsappv1/dashboard/";

// Dev stays at **`/`** with **`/api`** → **`backend_local`**; production build uses subdirectory base for **`www`**.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? DASHBOARD_BASE : "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:9002",
        changeOrigin: true,
      },
    },
  },
}));
