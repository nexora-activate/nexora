ALTER TABLE users ADD COLUMN banned boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE users SET role = 'patron' WHERE email = 'isaac.201294dz@gmail.com';
--> statement-breakpoint
