CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduled_for` integer NOT NULL,
	`object_key` text NOT NULL,
	`bookmark_hash` text NOT NULL,
	`etag` text NOT NULL,
	`size` integer NOT NULL,
	`completed_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_scheduled_for_unique` ON `backup_runs` (`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_object_key_unique` ON `backup_runs` (`object_key`);--> statement-breakpoint
CREATE INDEX `backup_runs_completed_at_idx` ON `backup_runs` (`completed_at`);