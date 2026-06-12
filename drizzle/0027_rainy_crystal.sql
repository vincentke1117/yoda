CREATE TABLE `ai_invocation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`mode` text NOT NULL,
	`runtime` text NOT NULL,
	`model` text,
	`command` text,
	`prompt` text,
	`output` text,
	`status` text NOT NULL,
	`error` text,
	`metadata` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE INDEX `idx_ai_invocation_logs_started_at` ON `ai_invocation_logs` (`started_at`);