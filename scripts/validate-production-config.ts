import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Config = { account_id?: unknown; vars?: Record<string, unknown>; d1_databases?: unknown; send_email?: unknown; r2_buckets?: unknown; workflows?: unknown };

/** Removes JSONC comments without touching URL-like strings. Wrangler configs need no broader parser. */
export const stripJsoncComments = (source: string) => {
  let result = ""; let quoted = false; let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]; const next = source[index + 1];
    if (quoted) { result += char; if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; result += char; continue; }
    if (char === "/" && next === "/") { while (index < source.length && source[index] !== "\n") index += 1; result += "\n"; continue; }
    if (char === "/" && next === "*") { index += 2; while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1; index += 1; continue; }
    result += char;
  }
  return result;
};

export const parseJsonc = (source: string): Json => JSON.parse(stripJsoncComments(source)) as Json;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const normalizedHost = (host: string) => host.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
const ipv4Parts = (host: string) => {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const values = parts.map(Number);
  return values.some((value) => value > 255) ? null : values;
};
const unsafeIpv4 = (host: string) => {
  const parts = ipv4Parts(host);
  return parts !== null && (parts[0] === 127 || (parts[0] === 0 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0));
};
const expandedIpv6 = (host: string) => {
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/i.test(part)) || left.length + right.length > 8) return null;
  const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return parts.length === 8 ? parts.map((part) => Number.parseInt(part, 16)) : null;
};
const unsafeIpv6 = (host: string) => {
  const parts = expandedIpv6(host);
  if (!parts) return false;
  if (parts.every((part) => part === 0) || parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return true;
  // URL normalisation turns ::ffff:127.0.0.1 into ::ffff:7f00:1. Detect mapped
  // IPv4 loopback/unspecified addresses after that normalisation as well.
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return unsafeIpv4(`${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`);
  }
  return false;
};
/** Reject loopback and unspecified origins. Private/LAN origins are deliberately out of scope. */
const localHost = (rawHost: string) => {
  const host = normalizedHost(rawHost);
  return host === "localhost" || host.endsWith(".localhost") || unsafeIpv4(host) || unsafeIpv6(host);
};
const httpsOrigin = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !localHost(url.hostname); } catch { return false; }
};
const configuredOrigins = (value: unknown) => typeof value === "string" ? value.split(",").map((origin) => origin.trim()).filter(Boolean) : [];
const placeholderD1 = (value: string) => !value || /placeholder|replace|your[_-]?d1|example|00000000-0000-0000-0000-000000000000/i.test(value);

/** Returns names of unsafe settings only. Never include config values or secret material in output. */
export const productionConfigErrors = (config: unknown) => {
  const source = record(config) as Config | null; const vars = record(source?.vars); const errors: string[] = [];
  if (!httpsOrigin(vars?.BETTER_AUTH_URL)) errors.push("BETTER_AUTH_URL must be an HTTPS non-localhost URL");
  const origins = configuredOrigins(vars?.BETTER_AUTH_TRUSTED_ORIGINS);
  if (!origins.length || origins.some((origin) => !httpsOrigin(origin))) errors.push("BETTER_AUTH_TRUSTED_ORIGINS must contain only HTTPS non-localhost origins");
  const sender = typeof vars?.EMAIL_FROM === "string" ? vars.EMAIL_FROM.trim() : "";
  if (!sender || /\.invalid$/i.test(sender)) errors.push("EMAIL_FROM must be a production sender address");
  if (vars?.EMAIL_DELIVERY_ENABLED !== "true") errors.push("EMAIL_DELIVERY_ENABLED must be true");
  const d1 = Array.isArray(source?.d1_databases) ? source.d1_databases.map(record) : [];
  if (!d1.some((database) => typeof database?.database_id === "string" && !placeholderD1(database.database_id.trim()))) errors.push("D1 database_id must be configured and not a placeholder");
  const configuredDatabaseId = typeof vars?.D1_DATABASE_ID === "string" ? vars.D1_DATABASE_ID.trim() : "";
  if (placeholderD1(configuredDatabaseId) || !d1.some((database) => database?.database_id === configuredDatabaseId)) errors.push("D1_DATABASE_ID must match a configured D1 database_id");
  const accountId = typeof vars?.CLOUDFLARE_ACCOUNT_ID === "string" ? vars.CLOUDFLARE_ACCOUNT_ID.trim() : "";
  if (placeholderD1(accountId)) errors.push("CLOUDFLARE_ACCOUNT_ID must be configured and not a placeholder");
  const configuredAccountId = typeof source?.account_id === "string" ? source.account_id.trim() : "";
  if (placeholderD1(configuredAccountId)) errors.push("account_id must be configured and not a placeholder");
  else if (configuredAccountId !== accountId) errors.push("account_id must match CLOUDFLARE_ACCOUNT_ID");
  const buckets = Array.isArray(source?.r2_buckets) ? source.r2_buckets.map(record) : [];
  if (!buckets.some((bucket) => bucket?.binding === "BACKUP_BUCKET" && typeof bucket.bucket_name === "string" && !placeholderD1(bucket.bucket_name.trim()))) errors.push("BACKUP_BUCKET must use a non-placeholder R2 bucket");
  const workflows = Array.isArray(source?.workflows) ? source.workflows.map(record) : [];
  if (!workflows.some((workflow) => workflow?.binding === "DAILY_BACKUP_WORKFLOW" && workflow.class_name === "DailyBackupWorkflow")) errors.push("Daily backup Workflow binding must be configured");
  const emailBindings = Array.isArray(source?.send_email) ? source.send_email.map(record) : [];
  const senderAllowed = emailBindings.some((binding) => Array.isArray(binding?.allowed_sender_addresses) && binding.allowed_sender_addresses.some((value) => value === sender));
  if (!senderAllowed) errors.push("send_email.allowed_sender_addresses must include EMAIL_FROM");
  return errors;
};

export async function validateProductionConfig(configPath = resolve(process.cwd(), "wrangler.jsonc")) {
  const source = await readFile(configPath, "utf8");
  let config: Json;
  try { config = parseJsonc(source); } catch { throw new Error("wrangler.jsonc を読み取れません。JSONCの構文を確認してください。"); }
  const errors = productionConfigErrors(config);
  if (errors.length) throw new Error(`本番deploy設定が安全ではありません。\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try { await validateProductionConfig(); } catch (error) { console.error(error instanceof Error ? error.message : "本番deploy設定を検証できません。"); process.exitCode = 1; }
}
