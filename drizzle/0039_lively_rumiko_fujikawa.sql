ALTER TABLE `feature_artifacts` ADD `source_task_id` text;--> statement-breakpoint
ALTER TABLE `feature_artifacts` ADD `source_room_id` text;--> statement-breakpoint
ALTER TABLE `feature_artifacts` ADD `source_message_id` text;--> statement-breakpoint
ALTER TABLE `feature_artifacts` ADD `source_member_id` text;--> statement-breakpoint
ALTER TABLE `team_rooms` ADD `feature_id` text;--> statement-breakpoint
CREATE INDEX `idx_feature_artifacts_source_task_id` ON `feature_artifacts` (`source_task_id`);--> statement-breakpoint
CREATE INDEX `idx_feature_artifacts_source_message_id` ON `feature_artifacts` (`source_message_id`);--> statement-breakpoint
CREATE INDEX `idx_team_rooms_feature_id` ON `team_rooms` (`feature_id`);