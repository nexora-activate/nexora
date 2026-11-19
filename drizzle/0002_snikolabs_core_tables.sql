DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE users (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  role text NOT NULL DEFAULT 'membre',
  created_at timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE verification_codes (
  id serial PRIMARY KEY,
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamp NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamp,
  created_at timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE server_requests (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  server_name text NOT NULL,
  plan text NOT NULL,
  theme text NOT NULL DEFAULT '',
  price_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'en_attente',
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE bot_subscriptions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  plan text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'actif',
  starts_at timestamp,
  ends_at timestamp,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);
