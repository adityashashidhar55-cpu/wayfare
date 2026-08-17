import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // r21-perf: pin the big vendors into stable long-cache chunks so
        // route chunks stay small; everything else is left to Rollup.
        manualChunks(id: string) {
          // Rollup's shared CJS helpers must not land in a lazy vendor chunk:
          // when they lived in vendor-map, the entry imported (and preloaded)
          // the 1MB maplibre chunk on every page.
          if (id.includes("commonjsHelpers")) return "vendor-react";
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|react-router|@remix-run)\//.test(id)) {
            return "vendor-react";
          }
          if (id.includes("node_modules/maplibre-gl/")) {
            return "vendor-map";
          }
          if (/node_modules\/(framer-motion|motion-utils|motion-dom)\//.test(id)) {
            return "vendor-motion";
          }
          return undefined;
        },
      },
    },
  },
});
