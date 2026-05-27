import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy → portfolio Site **backend_local** (default :9002)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:9002",
        changeOrigin: true,
      },
    },
  },
});
