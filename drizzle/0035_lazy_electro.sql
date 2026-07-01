ALTER TABLE `agent_teams` ADD `routing_hop_limit` integer DEFAULT 100;--> statement-breakpoint
ALTER TABLE `team_rooms` ADD `routing_hop_limit` integer DEFAULT 100;