CREATE TABLE reset_codes (
  id serial PRIMARY KEY,
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamp NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamp,
  created_at timestamp NOT NULL
);
--> statement-breakpoint
