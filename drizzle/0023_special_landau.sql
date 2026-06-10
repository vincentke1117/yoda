ALTER TABLE `conversations` ADD `auth_provider` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `diff_additions` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `diff_deletions` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `diff_captured_at` text;