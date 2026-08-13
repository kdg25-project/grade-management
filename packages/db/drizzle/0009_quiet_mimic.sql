PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduled_for` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claim_id` text,
	`started_at` integer,
	`object_key` text NOT NULL,
	`bookmark_hash` text,
	`etag` text,
	`size` integer,
	`completed_at` integer,
	`failed_at` integer,
	CONSTRAINT "backup_runs_status_check" CHECK(status IN ('pending', 'completed', 'failed')),
	CONSTRAINT "backup_runs_completed_metadata_check" CHECK(status != 'completed' OR (object_key IS NOT NULL AND bookmark_hash IS NOT NULL AND etag IS NOT NULL AND size IS NOT NULL AND completed_at IS NOT NULL))
);
--> statement-breakpoint
-- 0008 recorded completed runs only. Preserve every completed record while adding claims.
INSERT INTO `__new_backup_runs`("id", "scheduled_for", "status", "claim_id", "started_at", "object_key", "bookmark_hash", "etag", "size", "completed_at", "failed_at") SELECT "id", "scheduled_for", 'completed', NULL, "completed_at", "object_key", "bookmark_hash", "etag", "size", "completed_at", NULL FROM `backup_runs`;--> statement-breakpoint
DROP TABLE `backup_runs`;--> statement-breakpoint
ALTER TABLE `__new_backup_runs` RENAME TO `backup_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_scheduled_for_unique` ON `backup_runs` (`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_claim_id_unique` ON `backup_runs` (`claim_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_object_key_unique` ON `backup_runs` (`object_key`);--> statement-breakpoint
CREATE INDEX `backup_runs_completed_at_idx` ON `backup_runs` (`completed_at`);--> statement-breakpoint
CREATE INDEX `backup_runs_status_started_idx` ON `backup_runs` (`status`,`started_at`);
