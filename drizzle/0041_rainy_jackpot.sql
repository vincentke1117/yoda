ALTER TABLE `conversations` ADD `forked_from_conversation_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `forked_from_prompt_index` integer;--> statement-breakpoint
CREATE INDEX `idx_conversations_forked_from_conversation_id` ON `conversations` (`forked_from_conversation_id`);