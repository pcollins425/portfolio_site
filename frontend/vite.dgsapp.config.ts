import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

/** Embedded React dashboards for dgsappv1 — mounted in dashboard.html (no iframe). */
export default defineConfig({
  plugins: [react()],
  base: "/dgsappv1/dashboard/",
  build: {
    outDir: "../dgsappv1/dashboard",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "index.dgs.html"),
      output: {
        entryFileNames: "assets/dashboard.js",
        chunkFileNames: "assets/dashboard-[name].js",
        assetFileNames: "assets/dashboard[extname]",
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:9002",
        changeOrigin: true,
      },
    },
  },
});
