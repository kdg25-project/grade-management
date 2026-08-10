import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "apps/web",
  plugins: [react(), cloudflare({ configPath: "../../wrangler.jsonc" })],
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web", import.meta.url)) } },
  build: { outDir: "../../dist/client", emptyOutDir: true },
});
