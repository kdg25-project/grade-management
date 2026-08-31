CREATE TABLE `active_user_sessions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`session_token` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Preserve one already-valid session per user on rollout. updated_at, then created_at and id
-- make the initial marker deterministic even for timestamps with second precision.
INSERT INTO `active_user_sessions` (`user_id`, `session_token`, `updated_at`)
SELECT current.`user_id`, current.`token`, current.`updated_at`
FROM `session` AS current
WHERE current.`expires_at` > unixepoch()
  AND NOT EXISTS (
  SELECT 1
  FROM `session` AS newer
  WHERE newer.`user_id` = current.`user_id`
    AND newer.`expires_at` > unixepoch()
    AND (
      newer.`updated_at` > current.`updated_at`
      OR (newer.`updated_at` = current.`updated_at` AND newer.`created_at` > current.`created_at`)
      OR (
        newer.`updated_at` = current.`updated_at`
        AND newer.`created_at` = current.`created_at`
        AND newer.`id` > current.`id`
      )
    )
);
