import type { WorkflowStep } from "cloudflare:workers";

import { createWorkerId } from "../worker-crypto";
import { D1ExportClient, D1ExportError, type Fetcher } from "./d1-export";

export type BackupEvent = { payload: { scheduledFor?: number }; timestamp: Date; schedule?: { scheduledTime: number } };
export type BackupDependencies = {
  database: D1Database; bucket: R2Bucket; exportClient: D1ExportClient; fetcher?: Fetcher; newId?: () => string; now?: () => Date;
};
type StoredRun = {
  status: "pending" | "completed" | "failed";
  claimId: string | null;
  startedAt: number | null;
  objectKey: string | null;
  bookmarkHash: string | null;
};
type CompletedBackup = { objectKey: string; scheduledFor: number };
type Claim = { state: "claimed"; claimId: string; run: StoredRun } | { state: "completed"; result: CompletedBackup };

export class BackupRunError extends Error {
  constructor(readonly code: "BACKUP_IN_PROGRESS" | "BACKUP_RECORD_INVALID", message: string) { super(message); }
}

const POLL_LIMIT = 12;
// The maximum poll wait is below 41 minutes. A two-hour claim prevents a normal retry from
// taking over a still-running Workflow while it still owns the export side effect.
const CLAIM_TTL_SECONDS = 2 * 60 * 60;
const retries = { retries: { limit: 3, delay: "10 seconds" as const, backoff: "exponential" as const } };
const text = new TextEncoder();
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", text.encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
const jstDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const scheduledSeconds = (event: BackupEvent) => Math.floor((event.payload.scheduledFor ?? event.schedule?.scheduledTime ?? event.timestamp.getTime()) / 1_000);
const waitSeconds = (attempt: number): `${number} seconds` => `${Math.min(300, 10 * 2 ** attempt)} seconds`;
const safeMeta = (value: { scheduledFor: number; bookmarkHash: string }) => ({ scheduled_for: String(value.scheduledFor), bookmark_hash: value.bookmarkHash });
/** Stable per schedule: a retry can adopt the object without persisting the D1 bookmark or URL. */
export const dailyBackupKey = (date: Date, scheduledFor: number) => `daily/${jstDate(date)}/${scheduledFor}.sql`;

const readRun = (database: D1Database, scheduledFor: number) => database.prepare(
  "SELECT status AS status, claim_id AS claimId, started_at AS startedAt, object_key AS objectKey, bookmark_hash AS bookmarkHash FROM backup_runs WHERE scheduled_for=?",
).bind(scheduledFor).first<StoredRun>();

const completedResult = (run: StoredRun, scheduledFor: number): CompletedBackup => {
  if (!run.objectKey || !run.bookmarkHash) throw new BackupRunError("BACKUP_RECORD_INVALID", "バックアップ記録の整合性を確認できません。");
  return { objectKey: run.objectKey, scheduledFor };
};

/** Atomically owns this schedule before invoking the export API or R2. */
const claimScheduledBackup = async (database: D1Database, scheduledFor: number, objectKey: string, claimId: string, nowSeconds: number): Promise<Claim> => {
  const inserted = await database.prepare(
    "INSERT INTO backup_runs (id, scheduled_for, status, claim_id, started_at, object_key) VALUES (?,?,?,?,?,?) ON CONFLICT(scheduled_for) DO NOTHING",
  ).bind(claimId, scheduledFor, "pending", claimId, nowSeconds, objectKey).run();
  if (inserted.meta.changes === 1) return { state: "claimed", claimId, run: { status: "pending", claimId, startedAt: nowSeconds, objectKey, bookmarkHash: null } };

  const existing = await readRun(database, scheduledFor);
  if (!existing) throw new BackupRunError("BACKUP_RECORD_INVALID", "バックアップ記録の整合性を確認できません。");
  if (existing.status === "completed") return { state: "completed", result: completedResult(existing, scheduledFor) };

  // Failed claims retry immediately. Pending claims can be taken over only after the bounded
  // Workflow window; the UPDATE predicate is the CAS, not this preceding read.
  const takeover = await database.prepare(
    "UPDATE backup_runs SET status='pending', claim_id=?, started_at=?, failed_at=NULL WHERE scheduled_for=? AND (status='failed' OR (status='pending' AND started_at IS NOT NULL AND started_at <= ?))",
  ).bind(claimId, nowSeconds, scheduledFor, nowSeconds - CLAIM_TTL_SECONDS).run();
  if (takeover.meta.changes === 1) {
    const claimed = await readRun(database, scheduledFor);
    if (!claimed?.objectKey) throw new BackupRunError("BACKUP_RECORD_INVALID", "バックアップ記録の整合性を確認できません。");
    return { state: "claimed", claimId, run: claimed };
  }

  const current = await readRun(database, scheduledFor);
  if (current?.status === "completed") return { state: "completed", result: completedResult(current, scheduledFor) };
  throw new BackupRunError("BACKUP_IN_PROGRESS", "この時刻のバックアップはすでに実行中です。");
};

const recordCompleted = async (database: D1Database, scheduledFor: number, claimId: string, objectKey: string, bookmarkHash: string, object: Pick<R2Object, "etag" | "size">, completedAt: number) => {
  const result = await database.prepare(
    "UPDATE backup_runs SET status='completed', object_key=?, bookmark_hash=?, etag=?, size=?, completed_at=?, failed_at=NULL WHERE scheduled_for=? AND claim_id=? AND status='pending'",
  ).bind(objectKey, bookmarkHash, object.etag, object.size, completedAt, scheduledFor, claimId).run();
  if (result.meta.changes !== 1) throw new BackupRunError("BACKUP_IN_PROGRESS", "バックアップの実行権を確認できません。");
};

const markFailed = async (database: D1Database, scheduledFor: number, claimId: string, nowSeconds: number) => {
  await database.prepare(
    "UPDATE backup_runs SET status='failed', failed_at=? WHERE scheduled_for=? AND claim_id=? AND status='pending'",
  ).bind(nowSeconds, scheduledFor, claimId).run();
};

export async function runDailyBackup(event: BackupEvent, step: WorkflowStep, dependencies: BackupDependencies): Promise<CompletedBackup> {
  const now = dependencies.now ?? (() => new Date()); const fetcher = dependencies.fetcher ?? fetch; const newId = dependencies.newId ?? (() => createWorkerId());
  const scheduledFor = scheduledSeconds(event); const claimNow = Math.floor(now().getTime() / 1_000); const claimId = newId();
  const objectKey = dailyBackupKey(new Date(scheduledFor * 1_000), scheduledFor);
  const claim = await step.do<Claim>("claim scheduled backup", retries, async (_ctx) => claimScheduledBackup(dependencies.database, scheduledFor, objectKey, claimId, claimNow));
  if (claim.state === "completed") return claim.result;

  try {
    // A previous attempt may have put successfully and failed only while recording completion.
    // The durable intent lets this attempt adopt it without another export, download, or put.
    if (claim.run.bookmarkHash) {
      const existing = await step.do<{ etag: string; size: number } | null>("recover stored R2 backup", retries, async () => {
        const object = await dependencies.bucket.head(objectKey);
        return object ? { etag: object.etag, size: object.size } : null;
      });
      if (existing) {
        await step.do("record recovered backup", retries, async () => recordCompleted(dependencies.database, scheduledFor, claimId, objectKey, claim.run.bookmarkHash!, existing, Math.floor(now().getTime() / 1_000)));
        return { objectKey, scheduledFor };
      }
    }
    const started = await step.do<{ bookmark: string }>("start D1 export", retries, async (_ctx) => dependencies.exportClient.start());
    const bookmarkHash = await sha256(started.bookmark);
    const intent = await step.do<{ changes: number }>("record export intent", retries, async () => {
      const result = await dependencies.database.prepare(
        "UPDATE backup_runs SET bookmark_hash=? WHERE scheduled_for=? AND claim_id=? AND status='pending'",
      ).bind(bookmarkHash, scheduledFor, claimId).run();
      return { changes: result.meta.changes };
    });
    if (intent.changes !== 1) throw new BackupRunError("BACKUP_IN_PROGRESS", "バックアップの実行権を確認できません。");
    let ready: { filename: string; signedUrl: string } | null = null;
    for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
      const polled = await step.do<Awaited<ReturnType<D1ExportClient["poll"]>>>(`poll D1 export ${attempt + 1}`, retries, async (_ctx) => dependencies.exportClient.poll(started.bookmark));
      if (polled.ready) { ready = polled.export; break; }
      await step.sleep(`wait for D1 export ${attempt + 1}`, waitSeconds(attempt));
    }
    if (!ready) throw new D1ExportError("D1_EXPORT_POLL_FAILED", "D1エクスポートが所定時間内に完了しませんでした。");
    const uploaded = await step.do<{ objectKey: string; etag: string; size: number }>("store immutable R2 backup", retries, async (_ctx) => {
      // Re-check immediately before R2 side effects so an expired/taken-over claim cannot upload.
      const owned = await dependencies.database.prepare("SELECT 1 AS owned FROM backup_runs WHERE scheduled_for=? AND claim_id=? AND status='pending'").bind(scheduledFor, claimId).first<{ owned: number }>();
      if (!owned) throw new BackupRunError("BACKUP_IN_PROGRESS", "バックアップの実行権を確認できません。");
      const existing = await dependencies.bucket.head(objectKey);
      if (existing) return { objectKey, etag: existing.etag, size: existing.size };
      let response: Response;
      try { response = await fetcher(ready.signedUrl); } catch { throw new Error("バックアップファイルを取得できません。"); }
      if (!response.ok || !response.body) throw new Error("バックアップファイルを取得できません。");
      const stored = await dependencies.bucket.put(objectKey, response.body, { onlyIf: new Headers({ "If-None-Match": "*" }), httpMetadata: { contentType: "application/sql" }, customMetadata: safeMeta({ scheduledFor, bookmarkHash }) });
      // If another stale/fresh owner won the conditional create, adopt the one immutable object.
      const winner = stored ?? await dependencies.bucket.head(objectKey);
      if (!winner) throw new Error("バックアップファイルを保存できません。");
      return { objectKey, etag: winner.etag, size: winner.size };
    });
    await step.do("record completed backup", retries, async (_ctx) => recordCompleted(dependencies.database, scheduledFor, claimId, uploaded.objectKey, bookmarkHash, uploaded, Math.floor(now().getTime() / 1_000)));
    return { objectKey: uploaded.objectKey, scheduledFor };
  } catch (error) {
    await markFailed(dependencies.database, scheduledFor, claimId, Math.floor(now().getTime() / 1_000));
    throw error;
  }
}
