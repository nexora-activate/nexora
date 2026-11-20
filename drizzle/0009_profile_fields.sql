ALTER TABLE users ADD COLUMN bio text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN avatar_url text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN username_changed_at timestamp;
--> statement-breakpoint
