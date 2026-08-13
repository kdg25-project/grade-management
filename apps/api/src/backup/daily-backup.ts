import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { AuthEnvironment } from "../auth";
import { D1ExportClient } from "./d1-export";
import { runDailyBackup, type BackupEvent } from "./backup-run";

export type BackupEnvironment = AuthEnvironment & {
  BACKUP_BUCKET: R2Bucket;
  CLOUDFLARE_ACCOUNT_ID: string;
  D1_DATABASE_ID: string;
  D1_REST_API_TOKEN: string;
};
const requireText = (value: string, label: string) => { if (!value.trim()) throw new Error(`${label} is not configured`); return value; };

/** Daily Cloudflare Workflow. Retention/deletion is intentionally not implemented. */
export class DailyBackupWorkflow extends WorkflowEntrypoint<BackupEnvironment, { scheduledFor?: number }> {
  async run(event: Readonly<WorkflowEvent<{ scheduledFor?: number }>>, step: WorkflowStep) {
    const accountId = requireText(this.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
    const databaseId = requireText(this.env.D1_DATABASE_ID, "D1_DATABASE_ID");
    const token = requireText(this.env.D1_REST_API_TOKEN, "D1_REST_API_TOKEN");
    const backupEvent: BackupEvent = { payload: event.payload, timestamp: event.timestamp, ...(event.schedule ? { schedule: { scheduledTime: event.schedule.scheduledTime } } : {}) };
    return runDailyBackup(backupEvent, step, { database: this.env.DB, bucket: this.env.BACKUP_BUCKET, exportClient: new D1ExportClient(accountId, databaseId, token) });
  }
}
