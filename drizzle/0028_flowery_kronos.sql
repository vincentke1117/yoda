CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`workspace_name` text DEFAULT 'Yoda' NOT NULL,
	`prompt` text NOT NULL,
	`runtime` text NOT NULL,
	`schedule_label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`last_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
