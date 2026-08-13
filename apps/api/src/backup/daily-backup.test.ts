import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import type { WorkflowStep } from "cloudflare:workers";

import { BackupRunError, dailyBackupKey, runDailyBackup } from "./backup-run";
import { D1ExportClient, D1ExportError } from "./d1-export";

type Bound = { bind(...values: unknown[]): Bound; run(): Promise<{ meta: { changes: number } }>; first<T>(): Promise<T | null> };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const event = { payload: {}, timestamp: new Date("2026-08-12T17:00:00.000Z"), instanceId: "workflow-1", workflowName: "grade-management-daily-backup", schedule: { cron: "0 17 * * *", scheduledTime: Date.parse("2026-08-12T17:00:00.000Z") } } as const;

const createStep = () => {
  const names: string[] = []; const sleeps: string[] = [];
  return {
    names, sleeps,
    step: {
      async do(name: string, configOrCallback: unknown, maybeCallback?: unknown) {
        names.push(name); const callback = typeof configOrCallback === "function" ? configOrCallback as () => Promise<unknown> : maybeCallback as () => Promise<unknown>;
        return callback();
      },
      async sleep(name: string) { sleeps.push(name); },
    },
  };
};

const createDatabase = (options: { failCompletionOnce?: boolean } = {}) => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE backup_runs (
    id text PRIMARY KEY NOT NULL, scheduled_for integer NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
    claim_id text UNIQUE, started_at integer, object_key text NOT NULL UNIQUE, bookmark_hash text,
    etag text, size integer, completed_at integer, failed_at integer,
    CHECK(status != 'completed' OR (object_key IS NOT NULL AND bookmark_hash IS NOT NULL AND etag IS NOT NULL AND size IS NOT NULL AND completed_at IS NOT NULL))
  );`);
  const database = {
    prepare(query: string) {
      const build = (values: unknown[]): Bound => {
        const statement = sqlite.query(query) as unknown as { get(...args: unknown[]): unknown; run(...args: unknown[]): { changes: number } };
        return { bind: (...next: unknown[]) => build(next), async run() {
          if (options.failCompletionOnce && query.includes("SET status='completed'")) { options.failCompletionOnce = false; throw new Error("injected D1 completion failure"); }
          return { meta: { changes: statement.run(...values).changes } };
        }, async first<T>() { return statement.get(...values) as T | null; } };
      };
      return build([]);
    },
  } as unknown as D1Database;
  return { database, sqlite };
};

const createBucket = (setup: { beforePut?: (key: string, objects: Map<string, { etag: string; size: number }>) => void } = {}) => {
  const objects = new Map<string, { etag: string; size: number }>(); const puts: string[] = []; const putConditions: Headers[] = [];
  const bucket = {
    async head(key: string) { const object = objects.get(key); return object ? { key, ...object } : null; },
    async put(key: string, value: ReadableStream, options?: R2PutOptions) {
      if (!(options?.onlyIf instanceof Headers)) throw new Error("R2 conditional writes must use Headers");
      putConditions.push(options.onlyIf); setup.beforePut?.(key, objects);
      if (options.onlyIf.get("If-None-Match") === "*" && objects.has(key)) return null;
      puts.push(key); const bytes = await new Response(value).arrayBuffer(); const object = { etag: `etag-${puts.length}`, size: bytes.byteLength }; objects.set(key, object); return { key, ...object };
    },
  } as unknown as R2Bucket;
  return { bucket, objects, puts, putConditions };
};

const readyClient = (onStart?: () => void) => new D1ExportClient("account", "database", "secret-token", async (_url, init) => {
  const body = String(init?.body);
  if (body.includes("output_format")) { onStart?.(); return response({ success: true, result: { at_bookmark: "bookmark-sensitive" } }); }
  return response({ success: true, result: { status: "complete", result: { filename: "export.sql", signed_url: "https://download.example.test/export" } } });
});

describe("D1 daily backup export", () => {
  it("uses polling export requests and turns malformed responses into sanitized errors", async () => {
    const requests: RequestInit[] = [];
    const client = new D1ExportClient("account", "database", "secret-token", async (_url, init) => { requests.push(init!); return response({ success: true, result: { at_bookmark: "bookmark-1" } }); });
    await expect(client.start()).resolves.toEqual({ bookmark: "bookmark-1" });
    expect(requests[0]?.body).toBe('{"output_format":"polling"}');
    expect(requests[0]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer secret-token" }));
    const broken = new D1ExportClient("account", "database", "secret-token", async () => response({ success: true, result: {} }));
    await expect(broken.start()).rejects.toBeInstanceOf(D1ExportError);
  });

  it("reads D1's nested completed-export result and hides failures' sensitive values", async () => {
    const bookmark = "bookmark-sensitive"; const token = "secret-token";
    const complete = new D1ExportClient("account", "database", token, async () => response({ success: true, result: { status: "complete", result: { filename: "export.sql", signed_url: "https://download.example.test/export" } } }));
    await expect(complete.poll(bookmark)).resolves.toEqual({ ready: true, export: { filename: "export.sql", signedUrl: "https://download.example.test/export" } });
    const failed = new D1ExportClient("account", "database", token, async () => response({ success: false, errors: [{ message: `server saw ${bookmark}` }] }, 500));
    await expect(failed.poll(bookmark)).rejects.toMatchObject({ code: "D1_EXPORT_POLL_FAILED" });
    try { await failed.poll(bookmark); } catch (error) { expect(String(error)).not.toContain(bookmark); expect(String(error)).not.toContain(token); }
  });

  it("claims before export, streams to an immutable JST key, and records only safe metadata", async () => {
    const { step, sleeps } = createStep(); const { database, sqlite } = createDatabase(); const { bucket, puts } = createBucket();
    const result = await runDailyBackup(event, step as unknown as WorkflowStep, { database, bucket, exportClient: readyClient(), fetcher: async () => new Response("database export"), newId: () => "run-1", now: () => new Date("2026-08-12T17:01:00.000Z") });
    expect(result.objectKey).toBe("daily/2026-08-13/1786554000.sql");
    expect(sleeps).toEqual([]); expect(puts).toEqual([result.objectKey]);
    const rows = sqlite.query("SELECT * FROM backup_runs").all();
    expect(JSON.stringify(rows)).not.toContain("bookmark-sensitive");
    expect(JSON.stringify(rows)).not.toContain("download.example.test");
    expect(JSON.stringify(rows)).not.toContain("secret-token");
    expect(rows).toContainEqual(expect.objectContaining({ status: "completed", object_key: result.objectKey }));
    sqlite.close();
  });

  it("allows exactly one concurrent schedule owner to export, put, and complete", async () => {
    const { database, sqlite } = createDatabase(); const { bucket, puts } = createBucket(); let exports = 0; let ids = 0;
    const dependencies = { database, bucket, exportClient: readyClient(() => { exports += 1; }), fetcher: async () => new Response("database export"), newId: () => `run-${++ids}`, now: () => new Date("2026-08-12T17:01:00.000Z") };
    const first = runDailyBackup(event, createStep().step as unknown as WorkflowStep, dependencies);
    const second = runDailyBackup(event, createStep().step as unknown as WorkflowStep, dependencies);
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ code: "BACKUP_IN_PROGRESS" }) });
    expect(exports).toBe(1); expect(puts).toHaveLength(1);
    expect(sqlite.query("SELECT count(*) AS count FROM backup_runs WHERE status='completed'").get()).toEqual({ count: 1 });
    sqlite.close();
  });

  it("marks a failed claim for retry without leaving a completed record or object", async () => {
    const { database, sqlite } = createDatabase(); const { bucket, objects, puts } = createBucket(); let ids = 0;
    await expect(runDailyBackup(event, createStep().step as unknown as WorkflowStep, { database, bucket, exportClient: new D1ExportClient("account", "database", "secret-token", async () => { throw new Error("offline"); }), newId: () => `run-${++ids}`, now: () => new Date("2026-08-12T17:01:00.000Z") })).rejects.toBeInstanceOf(D1ExportError);
    expect(sqlite.query("SELECT status FROM backup_runs").get()).toEqual({ status: "failed" });
    expect(objects.size).toBe(0);
    const retried = await runDailyBackup(event, createStep().step as unknown as WorkflowStep, { database, bucket, exportClient: readyClient(), fetcher: async () => new Response("database export"), newId: () => `run-${++ids}`, now: () => new Date("2026-08-12T17:02:00.000Z") });
    expect(retried.objectKey).toContain("daily/2026-08-13/"); expect(puts).toHaveLength(1);
    expect(sqlite.query("SELECT status FROM backup_runs").get()).toEqual({ status: "completed" });
    sqlite.close();
  });

  it("adopts a successful put after D1 completion fails, with no orphan or repeated side effect", async () => {
    const { database, sqlite } = createDatabase({ failCompletionOnce: true }); const { bucket, objects, puts } = createBucket(); let starts = 0; let fetches = 0; let ids = 0;
    const dependencies = { database, bucket, exportClient: readyClient(() => { starts += 1; }), fetcher: async () => { fetches += 1; return new Response("database export"); }, newId: () => `run-${++ids}`, now: () => new Date("2026-08-12T17:01:00.000Z") };
    await expect(runDailyBackup(event, createStep().step as unknown as WorkflowStep, dependencies)).rejects.toThrow("injected D1 completion failure");
    expect(sqlite.query("SELECT status,object_key,bookmark_hash FROM backup_runs").get()).toEqual(expect.objectContaining({ status: "failed", object_key: "daily/2026-08-13/1786554000.sql" }));
    const retried = await runDailyBackup(event, createStep().step as unknown as WorkflowStep, dependencies);
    expect(retried.objectKey).toBe("daily/2026-08-13/1786554000.sql");
    expect({ starts, fetches, puts: puts.length, objects: objects.size }).toEqual({ starts: 1, fetches: 1, puts: 1, objects: 1 });
    expect(sqlite.query("SELECT status FROM backup_runs").get()).toEqual({ status: "completed" });
    sqlite.close();
  });

  it("uses If-None-Match: * to adopt a competing immutable object without overwriting it", async () => {
    const existing = { etag: "external-etag-742", size: 742 };
    const { database, sqlite } = createDatabase(); const { bucket, objects, puts, putConditions } = createBucket({ beforePut: (key, stored) => stored.set(key, existing) });
    const result = await runDailyBackup(event, createStep().step as unknown as WorkflowStep, { database, bucket, exportClient: readyClient(), fetcher: async () => new Response("database export"), newId: () => "run-1", now: () => new Date("2026-08-12T17:01:00.000Z") });
    expect(putConditions).toHaveLength(1); expect(putConditions[0]).toBeInstanceOf(Headers); expect(putConditions[0]?.get("If-None-Match")).toBe("*");
    expect(result.objectKey).toBe("daily/2026-08-13/1786554000.sql"); expect(puts).toEqual([]); expect(objects.get(result.objectKey)).toEqual(existing);
    expect(sqlite.query("SELECT etag,size,status FROM backup_runs").get()).toEqual({ etag: existing.etag, size: existing.size, status: "completed" });
    sqlite.close();
  });

  it("takes over a directly stale pending intent and completes it", async () => {
    const { database, sqlite } = createDatabase(); const { bucket, puts } = createBucket();
    sqlite.exec("INSERT INTO backup_runs (id,scheduled_for,status,claim_id,started_at,object_key) VALUES ('old',1786554000,'pending','old',1786540000,'daily/2026-08-13/1786554000.sql')");
    const result = await runDailyBackup(event, createStep().step as unknown as WorkflowStep, { database, bucket, exportClient: readyClient(), fetcher: async () => new Response("database export"), newId: () => "new", now: () => new Date("2026-08-12T18:01:00.000Z") });
    expect(result.objectKey).toBe("daily/2026-08-13/1786554000.sql"); expect(puts).toHaveLength(1);
    expect(sqlite.query("SELECT status,claim_id FROM backup_runs").get()).toEqual({ status: "completed", claim_id: "new" });
    sqlite.close();
  });

  it("returns a completed run idempotently without another export or R2 put", async () => {
    const { database, sqlite } = createDatabase(); const { bucket, puts } = createBucket(); let starts = 0; let ids = 0;
    const first = await runDailyBackup(event, createStep().step as unknown as WorkflowStep, { database, bucket, exportClient: readyClient(() => { starts += 1; }), fetcher: async () => new Response("database export"), newId: () => `run-${++ids}` });
    const second = await runDailyBackup(event, createStep().step as unknown as WorkflowStep, { database, bucket, exportClient: readyClient(() => { starts += 1; }), fetcher: async () => { throw new Error("must not fetch"); }, newId: () => `run-${++ids}` });
    expect(second).toEqual(first); expect(starts).toBe(1); expect(puts).toHaveLength(1);
    sqlite.close();
  });

  it("uses the schedule instant in JST for daily keys", () => {
    expect(dailyBackupKey(new Date("2026-03-31T15:00:00.000Z"), 42)).toBe("daily/2026-04-01/42.sql");
  });
});
