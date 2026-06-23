import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// On GitHub Pages (and `vite preview`, which runs in production mode) the app is served from
// /<repo>/; the dev server (development mode) serves from /.
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/GIS-Conflict-Dashboard/" : "/",
  plugins: [react(), wasm(), topLevelAwait()],
  // DuckDB-WASM ships its own workers/wasm; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm", "geokit"] },
  worker: { format: "es" },
  build: { target: "esnext" },
}));
