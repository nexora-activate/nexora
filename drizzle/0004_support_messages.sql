CREATE TABLE support_messages (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'nouveau',
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);
