import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Embedded React dashboards for dgsappv1 — base /dgsappv1/dashboard/ */
export default defineConfig({
  plugins: [react()],
  base: "/dgsappv1/dashboard/",
  build: {
    outDir: "../dgsappv1/dashboard",
    emptyOutDir: true,
  },
});
