import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// During local development the API runs on 127.0.0.1:8080. In production the
// nginx image proxies /api, /health, /ready and /metrics to the backend.
const apiTarget = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/health": { target: apiTarget, changeOrigin: true },
      "/ready": { target: apiTarget, changeOrigin: true },
      "/metrics": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
  },
});
