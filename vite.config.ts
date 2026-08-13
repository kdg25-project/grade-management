import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => ({
  root: "apps/web",
  plugins: [react(), cloudflare({
    configPath: "../../wrangler.jsonc",
    // E2E gets a disposable D1 state, leaving normal local development intact.
    ...(mode === "e2e" ? { persistState: { path: ".wrangler/e2e-state" }, inspectorPort: false } : {}),
  })],
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web", import.meta.url)) } },
  build: { outDir: "../../dist/client", emptyOutDir: true },
}));
