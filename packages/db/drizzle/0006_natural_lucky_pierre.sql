ALTER TABLE `grade_export_snapshots` ADD `claim_id` text;--> statement-breakpoint
ALTER TABLE `grade_export_snapshots` ADD `claimed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `grade_export_snapshots_claim_id_unique` ON `grade_export_snapshots` (`claim_id`);