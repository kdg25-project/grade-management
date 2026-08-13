CREATE TABLE `grade_export_snapshot_rows` (
	`snapshot_id` text NOT NULL,
	`position` integer NOT NULL,
	`student_number` text NOT NULL,
	`student_name` text NOT NULL,
	`academic_year` integer NOT NULL,
	`term` integer NOT NULL,
	`course_name` text NOT NULL,
	`grade_level` integer NOT NULL,
	`subject_name` text NOT NULL,
	`attendance_rate` integer NOT NULL,
	`letter_grade` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `position`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `grade_export_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `grade_export_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`academic_year` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_year`) REFERENCES `academic_years`(`year`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `grade_export_snapshots_owner_expiry_idx` ON `grade_export_snapshots` (`owner_user_id`,`expires_at`);