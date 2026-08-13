import { createWorkerApp } from "./app";
import { DailyBackupWorkflow, type BackupEnvironment } from "./backup/daily-backup";

export { DailyBackupWorkflow };

export default {
  fetch(request, env: BackupEnvironment, ctx) {
    return createWorkerApp(env, ctx).fetch(request);
  },
} satisfies ExportedHandler<BackupEnvironment>;
