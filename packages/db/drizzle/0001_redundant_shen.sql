CREATE TABLE `academic_years` (
	`year` integer PRIMARY KEY NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`selected_by_user_id` text,
	`selected_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`selected_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "academic_years_current_check" CHECK("academic_years"."is_current" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academic_years_current_unique` ON `academic_years` (`is_current`) WHERE "academic_years"."is_current" = 1;--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_created_idx` ON `audit_logs` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_name_unique` ON `courses` (`name`);--> statement-breakpoint
INSERT OR IGNORE INTO `courses` (`id`, `name`) VALUES
  ('system-engineer', 'システムエンジニア'),
  ('web-designer', 'Webデザイナー');--> statement-breakpoint
CREATE TABLE `grade_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`term` integer NOT NULL,
	`attendance_weight` integer NOT NULL,
	`attitude_weight` integer NOT NULL,
	`assignment_weight` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "grade_weights_term_check" CHECK("grade_weights"."term" IN (1, 2)),
	CONSTRAINT "grade_weights_range_check" CHECK("grade_weights"."attendance_weight" BETWEEN 0 AND 100
          AND "grade_weights"."attitude_weight" BETWEEN 0 AND 100
          AND "grade_weights"."assignment_weight" BETWEEN 0 AND 100),
	CONSTRAINT "grade_weights_total_check" CHECK("grade_weights"."attendance_weight" + "grade_weights"."attitude_weight" + "grade_weights"."assignment_weight" = 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grade_weights_subject_term_unique` ON `grade_weights` (`subject_id`,`term`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`academic_year` integer NOT NULL,
	`term` integer NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`attendance_rate` integer,
	`attitude` integer,
	`assignment` integer,
	`final_score_numerator` integer,
	`final_score_denominator` integer,
	`letter_grade` text,
	`entered_by_user_id` text,
	`last_updated_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_year`) REFERENCES `academic_years`(`year`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_updated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`,`academic_year`) REFERENCES `subjects`(`id`,`academic_year`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "grades_term_check" CHECK("grades"."term" IN (1, 2)),
	CONSTRAINT "grades_attempt_check" CHECK("grades"."attempt" >= 1),
	CONSTRAINT "grades_letter_grade_check" CHECK("grades"."letter_grade" IN ('S', 'A', 'B', 'C', 'F') OR "grades"."letter_grade" IS NULL),
	CONSTRAINT "grades_input_range_check" CHECK(("grades"."attendance_rate" IS NULL OR "grades"."attendance_rate" BETWEEN 0 AND 100)
          AND ("grades"."attitude" IS NULL OR "grades"."attitude" BETWEEN 0 AND 10)
          AND ("grades"."assignment" IS NULL OR "grades"."assignment" BETWEEN 0 AND 10)),
	CONSTRAINT "grades_final_score_representation_check" CHECK(("grades"."final_score_numerator" IS NULL AND "grades"."final_score_denominator" IS NULL)
          OR ("grades"."final_score_numerator" IS NOT NULL
            AND "grades"."final_score_denominator" IS NOT NULL
            AND "grades"."final_score_numerator" BETWEEN 0 AND 10000
            AND "grades"."final_score_denominator" = 100)),
	CONSTRAINT "grades_letter_grade_score_check" CHECK("grades"."letter_grade" IS NULL OR (
          "grades"."final_score_numerator" IS NOT NULL
          AND "grades"."final_score_denominator" IS NOT NULL
          AND "grades"."final_score_denominator" = 100
          AND (
            ("grades"."letter_grade" = 'S' AND "grades"."final_score_numerator" >= 9000)
            OR ("grades"."letter_grade" = 'A' AND "grades"."final_score_numerator" BETWEEN 8000 AND 8999)
            OR ("grades"."letter_grade" = 'B' AND "grades"."final_score_numerator" BETWEEN 7000 AND 7999)
            OR ("grades"."letter_grade" = 'C' AND "grades"."final_score_numerator" BETWEEN 6000 AND 6999)
            OR ("grades"."letter_grade" = 'F' AND "grades"."final_score_numerator" < 6000)
          )
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grades_student_subject_term_attempt_unique` ON `grades` (`student_id`,`subject_id`,`term`,`attempt`);--> statement-breakpoint
CREATE INDEX `grades_subject_year_term_idx` ON `grades` (`subject_id`,`academic_year`,`term`);--> statement-breakpoint
CREATE INDEX `grades_student_year_idx` ON `grades` (`student_id`,`academic_year`);--> statement-breakpoint
CREATE TABLE `idempotency_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`academic_year` integer,
	`payload_hash` text NOT NULL,
	`result_json` text,
	`created_by_user_id` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`academic_year`) REFERENCES `academic_years`(`year`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "idempotency_operations_type_check" CHECK("idempotency_operations"."operation_type" IN ('csv_import', 'annual_rollover')),
	CONSTRAINT "idempotency_operations_status_check" CHECK("idempotency_operations"."status" IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_operations_idempotency_key_unique` ON `idempotency_operations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idempotency_operations_type_status_idx` ON `idempotency_operations` (`operation_type`,`status`);--> statement-breakpoint
CREATE INDEX `idempotency_operations_year_idx` ON `idempotency_operations` (`academic_year`);--> statement-breakpoint
CREATE TABLE `student_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`effective_academic_year` integer NOT NULL,
	`changed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`changed_by_user_id` text,
	`reason` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`effective_academic_year`) REFERENCES `academic_years`(`year`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "student_status_history_status_check" CHECK("student_status_history"."status" IN ('enrolled', 'suspended', 'withdrawn', 'graduated'))
);
--> statement-breakpoint
CREATE INDEX `student_status_history_student_changed_idx` ON `student_status_history` (`student_id`,`changed_at`);--> statement-breakpoint
CREATE INDEX `student_status_history_effective_year_idx` ON `student_status_history` (`effective_academic_year`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`student_number` text NOT NULL,
	`name` text NOT NULL,
	`name_kana` text NOT NULL,
	`birth_date` text NOT NULL,
	`gender` text NOT NULL,
	`email` text,
	`phone` text,
	`postal_code` text,
	`address` text,
	`course_id` text NOT NULL,
	`enrollment_year` integer NOT NULL,
	`status` text DEFAULT 'enrolled' NOT NULL,
	`status_effective_academic_year` integer,
	`status_changed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`status_changed_by_user_id` text,
	`has_failed_history` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_year`) REFERENCES `academic_years`(`year`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_effective_academic_year`) REFERENCES `academic_years`(`year`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_changed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "students_status_check" CHECK("students"."status" IN ('enrolled', 'suspended', 'withdrawn', 'graduated')),
	CONSTRAINT "students_terminal_status_effective_year_check" CHECK("students"."status" NOT IN ('withdrawn', 'graduated') OR "students"."status_effective_academic_year" IS NOT NULL),
	CONSTRAINT "students_failed_history_check" CHECK("students"."has_failed_history" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_student_number_unique` ON `students` (`student_number`);--> statement-breakpoint
CREATE INDEX `students_course_year_idx` ON `students` (`course_id`,`enrollment_year`);--> statement-breakpoint
CREATE INDEX `students_status_effective_year_idx` ON `students` (`status`,`status_effective_academic_year`);--> statement-breakpoint
CREATE TABLE `subject_courses` (
	`subject_id` text NOT NULL,
	`course_id` text NOT NULL,
	PRIMARY KEY(`subject_id`, `course_id`),
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subject_courses_course_idx` ON `subject_courses` (`course_id`);--> statement-breakpoint
CREATE TABLE `subject_term_statuses` (
	`subject_id` text NOT NULL,
	`term` integer NOT NULL,
	`is_finalized` integer DEFAULT false NOT NULL,
	`finalized_by_user_id` text,
	`finalized_at` integer,
	`reopened_by_user_id` text,
	`reopened_at` integer,
	`reopened_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`subject_id`, `term`),
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finalized_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reopened_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "subject_term_statuses_term_check" CHECK("subject_term_statuses"."term" IN (1, 2)),
	CONSTRAINT "subject_term_statuses_finalized_check" CHECK("subject_term_statuses"."is_finalized" IN (0, 1)),
	CONSTRAINT "subject_term_statuses_finalized_metadata_check" CHECK("subject_term_statuses"."is_finalized" = 0 OR ("subject_term_statuses"."finalized_by_user_id" IS NOT NULL AND "subject_term_statuses"."finalized_at" IS NOT NULL)),
	CONSTRAINT "subject_term_statuses_reopened_metadata_check" CHECK(("subject_term_statuses"."reopened_by_user_id" IS NULL AND "subject_term_statuses"."reopened_at" IS NULL)
          OR ("subject_term_statuses"."reopened_by_user_id" IS NOT NULL AND "subject_term_statuses"."reopened_at" IS NOT NULL))
);
--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_year` integer NOT NULL,
	`name` text NOT NULL,
	`grade_level` integer NOT NULL,
	`teacher_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`academic_year`) REFERENCES `academic_years`(`year`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "subjects_grade_level_check" CHECK("subjects"."grade_level" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_id_academic_year_unique` ON `subjects` (`id`,`academic_year`);--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_year_name_grade_unique` ON `subjects` (`academic_year`,`name`,`grade_level`);--> statement-breakpoint
CREATE INDEX `subjects_teacher_year_idx` ON `subjects` (`teacher_user_id`,`academic_year`);
