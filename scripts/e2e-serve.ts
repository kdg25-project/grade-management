import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(root, ".dev.vars.e2e");
const requiredKeys = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "BETTER_AUTH_TRUSTED_ORIGINS"] as const;
type RequiredKey = (typeof requiredKeys)[number];

function parseE2EDevVars(source: string) {
  const values = new Map<string, string>();
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Invalid E2E .dev.vars entry.");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!requiredKeys.includes(key as RequiredKey) || !value) throw new Error("Unexpected or empty E2E .dev.vars entry.");
    values.set(key, value);
  }
  const missing = requiredKeys.filter((key) => !values.has(key));
  if (missing.length) throw new Error(`Missing E2E local variables: ${missing.join(", ")}`);
  return Object.fromEntries(requiredKeys.map((key) => [key, values.get(key)!])) as Record<RequiredKey, string>;
}

const values = parseE2EDevVars(await readFile(devVarsPath, "utf8"));
const vite = join(root, "node_modules", "vite", "bin", "vite.js");
const child = Bun.spawn(
  ["node", vite, "--config", "vite.config.ts", "--mode", "e2e", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  {
    cwd: root,
    // Wrangler's documented process-env loading keeps e2e secrets mode-scoped
    // without selecting a non-existent named Wrangler environment.
    env: { PATH: process.env.PATH ?? "", CLOUDFLARE_INCLUDE_PROCESS_ENV: "true", ...values },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await child.exited;
