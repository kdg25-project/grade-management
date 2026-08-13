CREATE TABLE `import_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`academic_year` integer NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claim_id` text,
	`claimed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_year`) REFERENCES `academic_years`(`year`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_snapshots_claim_id_unique` ON `import_snapshots` (`claim_id`);--> statement-breakpoint
CREATE INDEX `import_snapshots_owner_expiry_idx` ON `import_snapshots` (`owner_user_id`,`expires_at`);