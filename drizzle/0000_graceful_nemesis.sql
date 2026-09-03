CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_tokens_user_idx` ON `auth_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `category_overrides` (
	`user_id` integer NOT NULL,
	`phrase` text NOT NULL,
	`category` text NOT NULL,
	`hits` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `phrase`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`base_minor` integer NOT NULL,
	`rate` real DEFAULT 1 NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`spent_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`source` text DEFAULT 'bot' NOT NULL,
	`raw_text` text,
	`chat_id` integer,
	`message_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `expenses_user_spent_idx` ON `expenses` (`user_id`,`spent_at`);--> statement-breakpoint
CREATE INDEX `expenses_user_alive_idx` ON `expenses` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `expenses_user_cat_idx` ON `expenses` (`user_id`,`category`,`spent_at`);--> statement-breakpoint
CREATE TABLE `limits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`category` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`notified_level` integer DEFAULT 0 NOT NULL,
	`period_key` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `limits_user_category_idx` ON `limits` (`user_id`,`category`);--> statement-breakpoint
CREATE TABLE `rates` (
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` real NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`base`, `quote`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`origin` text DEFAULT 'magic-link' NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text,
	`username` text,
	`photo_url` text,
	`language_code` text,
	`timezone` text DEFAULT 'Asia/Dushanbe' NOT NULL,
	`base_currency` text DEFAULT 'TJS' NOT NULL,
	`week_start` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`first_expense_at` integer
);
