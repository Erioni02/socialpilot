import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`, changeOrigin: false } }
  },
  test: { environment: "jsdom" }
} as never);
