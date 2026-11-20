// Drizzle schema for NEXORA — Postgres (Supabase), via DATABASE_URL.
//
// Tables:
//   users              — real accounts (e-mail + scrypt-hashed password)
//   verification_codes — 6-digit signup codes, hashed, 10-minute expiry
//   reset_codes        — 6-digit password-reset codes, hashed, 10-minute
//                        expiry (separate table from verification_codes so
//                        a signup code can never reset a password, and a
//                        reset code can never create an account)
//   sessions           — login sessions (token stored hashed)
//   server_requests    — Discord server creation requests (Démo / Premium)
//   bot_subscriptions  — sniko bot activations (24 h / 3 months / 1 year)
//   email_deliveries   — real SMTP sends of signup codes (status tracking)
//   support_messages   — messages sent from the "Contact Support" panel,
//                        read and handled by the Patron in the admin dashboard
//   notification_emails — real SMTP notifications sent to the NEXORA
//                        address (nexora.activate@gmail.com) whenever a
//                        user contacts support or requests a server
//   discord_config     — Discord OAuth setup for the "sniko" application
//                        (Client ID 1571508442114560112): the Client Secret
//                        and the redirect URI, entered by the Patron in the
//                        admin dashboard, never sent back to clients; also
//                        holds the bot API key (X-Nexora-Api-Key) the Patron
//                        can set for the Discord-roles sync endpoint.
//                        Environment variables (DISCORD_CLIENT_SECRET,
//                        DISCORD_REDIRECT_URI, NEXORA_API_KEY) win over this
//                        table when they are set.
//   discord_login_codes — one row per Discord sign-in attempt: first the
//                        OAuth "state" (hashed, 10-minute expiry, bound to
//                        the logged-in user when the flow starts from the
//                        dashboard), then, once Discord has answered, the
//                        authorized Discord identity held behind a hashed
//                        pending token until the user confirms the link
// Users carry discord_id / discord_username / discord_avatar once their
// Discord account is linked (with their explicit confirmation).

import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  // Rôle du compte : membre par défaut ; patron (réservé à
  // isaac.201294dz@gmail.com, voir register) ; moderateur / moderatrice :
  // modérateurs du site, nommés par le Patron — ils voient les comptes et
  // peuvent les bannir, mais ne changent ni mots de passe, ni offres, ni
  // permissions. Le rôle est un simple texte en base (pas d'enum natif),
  // comme depuis la migration 0002.
  role: text("role", { enum: ["membre", "patron", "moderateur", "moderatrice"] })
    .notNull()
    .default("membre"),
  // Compte banni par le Patron ou un modérateur : il ne peut plus se
  // connecter (ni par e-mail ni par Discord) et toutes ses sessions
  // sont fermées au moment du ban.
  banned: boolean("banned").notNull().default(false),
  discordId: text("discord_id"),
  discordUsername: text("discord_username").notNull().default(""),
  discordAvatar: text("discord_avatar").notNull().default(""),
  // Profil modifiable par l'utilisateur : biographie libre, photo de
  // profil par adresse d'image, et date du dernier changement de pseudo
  // (NULL = jamais changé : le premier changement est toujours permis).
  bio: text("bio").notNull().default(""),
  avatarUrl: text("avatar_url").notNull().default(""),
  usernameChangedAt: timestamp("username_changed_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const discordConfig = pgTable("discord_config", {
  id: serial("id").primaryKey(),
  clientSecret: text("client_secret").notNull().default(""),
  redirectUri: text("redirect_uri").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const discordLoginCodes = pgTable("discord_login_codes", {
  id: serial("id").primaryKey(),
  stateHash: text("state_hash"),
  userId: integer("user_id").references(() => users.id),
  pendingTokenHash: text("pending_token_hash"),
  discordId: text("discord_id").notNull().default(""),
  discordUsername: text("discord_username").notNull().default(""),
  discordAvatar: text("discord_avatar").notNull().default(""),
  discordEmail: text("discord_email").notNull().default(""),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  usedAt: timestamp("used_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const resetCodes = pgTable("reset_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  usedAt: timestamp("used_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const emailDeliveries = pgTable("email_deliveries", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeId: integer("code_id")
    .notNull()
    .references(() => verificationCodes.id),
  status: text("status", { enum: ["en_cours", "envoye", "echec"] })
    .notNull()
    .default("en_cours"),
  taskId: text("task_id"),
  error: text("error").notNull().default(""),
  sentAt: timestamp("sent_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const notificationEmails = pgTable("notification_emails", {
  id: serial("id").primaryKey(),
  kind: text("kind", { enum: ["support", "serveur"] }).notNull(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["en_cours", "envoye", "echec"] })
    .notNull()
    .default("en_cours"),
  taskId: text("task_id"),
  error: text("error").notNull().default(""),
  sentAt: timestamp("sent_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const serverRequests = pgTable("server_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  serverName: text("server_name").notNull(),
  plan: text("plan", { enum: ["demo", "premium"] }).notNull(),
  theme: text("theme").notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  status: text("status", {
    enum: ["en_attente_paiement", "en_attente", "en_cours", "termine", "annule"],
  })
    .notNull()
    .default("en_attente"),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  message: text("message").notNull(),
  status: text("status", { enum: ["nouveau", "traite"] })
    .notNull()
    .default("nouveau"),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const botSubscriptions = pgTable("bot_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  plan: text("plan", { enum: ["gratuit", "premium", "premium_plus", "annuel"] }).notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  status: text("status", {
    enum: ["en_attente_paiement", "actif", "annule"],
  })
    .notNull()
    .default("actif"),
  startsAt: timestamp("starts_at", { mode: "date" }),
  endsAt: timestamp("ends_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
});
