CREATE TABLE `review_orchestrations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`implementer_conversation_id` text NOT NULL,
	`requirement` text DEFAULT '' NOT NULL,
	`reviewer_runtime` text NOT NULL,
	`reviewer_system_prompt` text DEFAULT '' NOT NULL,
	`reviewer_auto_approve` integer DEFAULT false NOT NULL,
	`max_rounds` integer NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'awaiting_impl' NOT NULL,
	`current_reviewer_conversation_id` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_review_orchestrations_task_id` ON `review_orchestrations` (`task_id`);