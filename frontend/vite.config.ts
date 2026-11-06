import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // Dev proxy: lets the browser call /api without CORS issues.
      proxy: { "/api": { target: env.VITE_PROXY_TARGET || "http://localhost:8000", changeOrigin: true } },
    },
  };
});
