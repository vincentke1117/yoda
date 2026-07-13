CREATE TABLE `feature_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`uri` text NOT NULL,
	`content_hash` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_at` text,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feature_events` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_type` text DEFAULT 'user' NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feature_issues` (
	`feature_id` text NOT NULL,
	`issue_url` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`feature_id`, `issue_url`),
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_url`) REFERENCES `issues`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feature_tasks` (
	`feature_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`feature_id`, `task_id`),
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`problem` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`non_goals` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'problem' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`template_id` text DEFAULT 'feature-development-v1' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_feature_artifacts_feature_id` ON `feature_artifacts` (`feature_id`);--> statement-breakpoint
CREATE INDEX `idx_feature_artifacts_feature_type` ON `feature_artifacts` (`feature_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_feature_events_feature_id` ON `feature_events` (`feature_id`);--> statement-breakpoint
CREATE INDEX `idx_feature_events_feature_created_at` ON `feature_events` (`feature_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_feature_issues_issue_url` ON `feature_issues` (`issue_url`);--> statement-breakpoint
CREATE INDEX `idx_feature_tasks_task_id` ON `feature_tasks` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_features_project_id` ON `features` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_features_project_stage` ON `features` (`project_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_features_project_status` ON `features` (`project_id`,`status`);