CREATE TABLE email_deliveries (
  id serial PRIMARY KEY,
  email text NOT NULL,
  code_id integer NOT NULL REFERENCES verification_codes(id),
  status text NOT NULL DEFAULT 'en_cours',
  task_id text,
  error text NOT NULL DEFAULT '',
  sent_at timestamp,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);
