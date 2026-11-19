CREATE TABLE notification_emails (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  user_id integer NOT NULL REFERENCES users(id),
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'en_cours',
  task_id text,
  error text NOT NULL DEFAULT '',
  sent_at timestamp,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);
