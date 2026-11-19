CREATE TABLE discord_config (
  id serial PRIMARY KEY,
  client_secret text NOT NULL DEFAULT '',
  redirect_uri text NOT NULL DEFAULT '',
  updated_at timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE discord_login_codes (
  id serial PRIMARY KEY,
  state_hash text,
  user_id integer REFERENCES users(id),
  pending_token_hash text,
  discord_id text NOT NULL DEFAULT '',
  discord_username text NOT NULL DEFAULT '',
  discord_email text NOT NULL DEFAULT '',
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN discord_id text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN discord_username text NOT NULL DEFAULT '';
