CREATE TABLE `enrichments` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`source` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_enrich_host_source` ON `enrichments` (`host_id`,`source`);--> statement-breakpoint
CREATE TABLE `host_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`run_id` text,
	`observed_at` integer NOT NULL,
	`banner` text NOT NULL,
	`banner_hash` text NOT NULL,
	`cert_fingerprint` text,
	`source` text NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `query_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_obs_host_time` ON `host_observations` (`host_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_obs_hash` ON `host_observations` (`banner_hash`);--> statement-breakpoint
CREATE TABLE `host_query_matches` (
	`host_id` text NOT NULL,
	`run_id` text NOT NULL,
	`is_new` integer NOT NULL,
	`is_changed` integer NOT NULL,
	PRIMARY KEY(`host_id`, `run_id`),
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `query_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_matches_run` ON `host_query_matches` (`run_id`);--> statement-breakpoint
CREATE TABLE `host_tags` (
	`host_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`host_id`, `tag_id`),
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip` text NOT NULL,
	`port` integer NOT NULL,
	`asn` integer,
	`country` text,
	`org` text,
	`hostname` text,
	`cert_serial` text,
	`cert_issuer` text,
	`cert_subject` text,
	`jarm` text,
	`favicon_hash` text,
	`ja4x` text,
	`triage_state` text DEFAULT 'new' NOT NULL,
	`snooze_until` integer,
	`notes` text,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hosts_triage` ON `hosts` (`triage_state`,`last_seen`);--> statement-breakpoint
CREATE INDEX `idx_hosts_asn` ON `hosts` (`asn`);--> statement-breakpoint
CREATE INDEX `idx_hosts_cert` ON `hosts` (`cert_serial`);--> statement-breakpoint
CREATE INDEX `idx_hosts_jarm` ON `hosts` (`jarm`);--> statement-breakpoint
CREATE INDEX `idx_hosts_favicon` ON `hosts` (`favicon_hash`);--> statement-breakpoint
CREATE INDEX `idx_hosts_snooze` ON `hosts` (`snooze_until`);--> statement-breakpoint
CREATE TABLE `pivots` (
	`id` text PRIMARY KEY NOT NULL,
	`from_host_id` text NOT NULL,
	`to_host_id` text NOT NULL,
	`pivot_type` text NOT NULL,
	`pivot_value` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`from_host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pivots_from` ON `pivots` (`from_host_id`);--> statement-breakpoint
CREATE INDEX `idx_pivots_to` ON `pivots` (`to_host_id`);--> statement-breakpoint
CREATE TABLE `queries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`query_string` text NOT NULL,
	`source` text NOT NULL,
	`tags` text DEFAULT '[]',
	`schedule` text,
	`last_run_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `query_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`query_id` text NOT NULL,
	`run_at` integer NOT NULL,
	`total_count` integer,
	`new_count` integer,
	`changed_count` integer,
	`raw_response_key` text,
	`error_message` text,
	FOREIGN KEY (`query_id`) REFERENCES `queries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_runs_query` ON `query_runs` (`query_id`,`run_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);