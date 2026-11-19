ALTER TABLE users ADD COLUMN discord_avatar text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE discord_login_codes ADD COLUMN discord_avatar text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE discord_config ADD COLUMN api_key text NOT NULL DEFAULT '';
