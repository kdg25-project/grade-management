import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const parseDevVars = (source: string) => Object.fromEntries(
  source.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

describe("local development variable template", () => {
  it("overrides production auth and email values with safe localhost settings", async () => {
    const template = parseDevVars(await readFile(resolve(root, ".dev.vars.example"), "utf8"));

    expect(template).toMatchObject({
      BETTER_AUTH_SECRET: "replace-with-a-random-secret-at-least-32-characters-long",
      BETTER_AUTH_URL: "http://localhost:5173",
      BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:5173",
      EMAIL_FROM: "no-reply@example.invalid",
      EMAIL_DELIVERY_ENABLED: "false",
    });
  });
});
