CREATE TABLE `feature_workflow_owners` (
	`task_id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_feature_workflow_owners_feature_id` ON `feature_workflow_owners` (`feature_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_team_rooms_active_feature_workflow_task` ON `team_rooms` (`project_id`,`task_id`) WHERE "team_rooms"."preset" = 'feature-workflow' AND "team_rooms"."status" = 'active';