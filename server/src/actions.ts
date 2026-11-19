// NEXORA — server actions.
//
// Real accounts (scrypt-hashed passwords, via the privileged crypto
// helpers), real 6-digit verification codes (hashed, 10-minute expiry,
// verified server-side), real sessions, real server requests and bot
// subscriptions with real durations, and a real Patron admin dashboard.
// Paid plans create orders in "en_attente_paiement" state; the Patron
// validates them from the admin dashboard, which starts the real
// subscription clock (no fake payment).
//
// Signup rules (2026-11-16): an e-mail that already has an account is
// refused with "Cette adresse e-mail est déjà utilisée."; code sends are
// limited to one every 30 seconds per address (server-side cooldown);
// passwords must be 8 to 12 characters with 1 to 5 digits. Format checks
// (e-mail shape, username 2-30 chars, code = exactly 6 digits) run inside
// the handlers with clear translated messages, so a bad username can
// never surface as a bare generic failure.
//
// Signup codes are delivered by REAL e-mail: requestSignupCode stores the
// code hashed, records an email_deliveries row, and sends the code by
// SMTP (Nodemailer, Gmail account nexora.activate@gmail.com, app
// password from the GMAIL_APP_PASSWORD environment variable — see
// ./mailer.ts). The delivery row is then marked envoye or echec from the
// SMTP result. The code itself is NEVER returned to the client.
//
// Support messages and server requests ALSO notify the NEXORA address by
// real e-mail (same SMTP channel): sendSupportMessage and requestServer
// record a notification_emails row and send the details to
// nexora.activate@gmail.com, marking the row envoye/echec from the SMTP
// result. The notification is best-effort: the support message / server
// request is stored first and stays visible in the Patron dashboard even
// if the e-mail fails.
//
// Discord sign-in is a REAL OAuth2 flow against the existing Discord
// application "sniko" (Client ID 1571508442114560112, the sniko bot app):
// startDiscordLogin stores a hashed, 10-minute "state" and returns the
// discord.com authorize URL; Discord redirects back to the redirect URI;
// completeDiscordLogin checks the state and exchanges the code for the
// Discord identity (id, username, avatar) through the privileged host
// handler (the only place the Client Secret is used). The Client Secret
// and redirect URI come FIRST from the DISCORD_CLIENT_SECRET /
// DISCORD_REDIRECT_URI environment variables (read on the host via the
// privileged readEnv handler); when the environment does not provide
// them, the values the Patron saved in the admin dashboard (table
// discord_config) are used. The secret is never sent back to any client
// and never logged. The button's job is LINKING: a Discord account that
// is already linked logs its owner in directly; a new Discord identity
// is held behind a hashed pending token and is only linked after the
// user explicitly confirms ("Voulez-vous connecter votre compte Discord
// à votre compte ?") via confirmDiscordLink — either as the user who
// started the flow from the dashboard, or as the user logged in when
// confirming.
//
// Patron role (security rule, 2026-11-19): the role is granted ONLY to
// the account whose e-mail is isaac.201294dz@gmail.com — never from the
// username. Registering with the username "sniko" no longer grants
// anything (the UI shows the "voleur" easter egg for that username).
// No password is ever hard-coded: the Patron account's password is set
// by its owner through the normal signup flow.
//
// Bot API: getDiscordRoles is the sync endpoint the Discord bot calls
// (the /api/discord/roles equivalent on this action-based platform): it
// requires the NEXORA_API_KEY (environment variable first, otherwise
// the key the Patron saved in the admin dashboard; with no key
// configured it refuses everyone) and returns the Discord-linked users
// with their current plan mapped to free / premium / premium+ /
// annuelle, so the bot can assign the matching Discord roles.

import { defineAction, z, type ActionsModule, type Ctx } from "./framework";
import { privileged } from "@space/privileged";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Db = ReturnType<Ctx["db"]>;

const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
// Un seul envoi de code toutes les 30 secondes par adresse e-mail :
// impossible de mettre 10 fois la même adresse ni de renvoyer à l'infini.
const RESEND_COOLDOWN_MS = 30 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;

// Format d'e-mail vérifié DANS les handlers (pas seulement par le schéma
// de transport) : une adresse mal formée reçoit un message clair et
// traduit, jamais une erreur générique incompréhensible.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Offres du bot (2026-11-16, refonte demandée par sniko) :
//   gratuit      0 €     — activation de 24 h avec publicité
//   premium      3,99 €  — 1 mois (30 jours), toutes les commandes
//   premium_plus 10 €    — 5 mois (150 jours), mêmes avantages que Premium
//   annuel       30 €    — 1 an (365 jours), mêmes avantages que Premium
// Un abonnement payant ACTIF débloque aussi la création de serveur Premium
// (incluse, sans frais en plus) — vérifié côté serveur à chaque demande.
const BOT_DAYS: Record<string, number> = { gratuit: 1, premium: 30, premium_plus: 150, annuel: 365 };
const BOT_PRICE: Record<string, number> = { gratuit: 0, premium: 399, premium_plus: 1000, annuel: 3000 };
const SERVER_PRICE: Record<string, number> = { demo: 0, premium: 0 };

async function sha(ctx: Ctx, value: string): Promise<string> {
  const res = await ctx.executePrivileged(privileged.sha256, { value });
  return res.hash;
}

async function createSession(ctx: Ctx, db: Db, userId: number): Promise<string> {
  const { token } = await ctx.executePrivileged(privileged.randomToken, {});
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: await sha(ctx, token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

type AuthedUser = typeof schema.users.$inferSelect;

async function requireUser(ctx: Ctx, db: Db, token: string): Promise<AuthedUser | null> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, await sha(ctx, token)))
    .limit(1);
  const session = rows[0];
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  return userRows[0] ?? null;
}

async function requirePatron(ctx: Ctx, db: Db, token: string): Promise<AuthedUser | null> {
  const user = await requireUser(ctx, db, token);
  if (!user || user.role !== "patron") return null;
  return user;
}

function publicUser(user: AuthedUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    discordId: user.discordId ?? null,
    discordUsername: user.discordUsername ?? "",
    discordAvatar: user.discordAvatar ?? "",
  };
}

function botRow(row: typeof schema.botSubscriptions.$inferSelect) {
  const now = Date.now();
  const endsAt = row.endsAt ? row.endsAt.getTime() : null;
  const expired = row.status === "actif" && endsAt !== null && endsAt <= now;
  return {
    id: row.id,
    userId: row.userId,
    plan: row.plan,
    priceCents: row.priceCents,
    status: expired ? ("expire" as const) : row.status,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// Vrai contrôle d'accès Premium, côté serveur : l'utilisateur a-t-il un
// abonnement bot PAYANT actif (premium, premium_plus ou annuel, non
// expiré) ? C'est ce contrôle — et lui seul — qui débloque les fonctions
// payantes (serveur Premium inclus). Rien côté client ne peut le contourner.
async function hasActivePaidBot(db: Db, userId: number): Promise<boolean> {
  const now = Date.now();
  const rows = await db
    .select()
    .from(schema.botSubscriptions)
    .where(
      and(
        eq(schema.botSubscriptions.userId, userId),
        eq(schema.botSubscriptions.status, "actif"),
      ),
    );
  return rows.some(
    (r) => r.plan !== "gratuit" && r.endsAt !== null && r.endsAt.getTime() > now,
  );
}

// Adresse e-mail de NEXORA : c'est le compte Gmail qui envoie les
// e-mails de la plateforme (SMTP). Les messages du support et les
// demandes de serveur y arrivent en vrai, par e-mail.
const NEXORA_INBOX = "nexora.activate@gmail.com";

// Enregistre une notification et l'envoie réellement par e-mail (SMTP)
// à l'adresse NEXORA, puis marque la ligne envoye ou echec selon le
// résultat SMTP. Ne fait jamais échouer l'action appelante : en cas de
// problème, la ligne passe en "echec" avec l'erreur, et la demande reste
// stockée (visible dans le tableau de bord du Patron).
async function notifyNexora(
  ctx: Ctx,
  db: Db,
  args: {
    kind: "support" | "serveur";
    userId: number;
    subject: string;
    body: string;
  },
): Promise<void> {
  const inserted = await db
    .insert(schema.notificationEmails)
    .values({
      kind: args.kind,
      userId: args.userId,
      subject: args.subject,
      body: args.body,
      status: "en_cours",
    })
    .returning();
  const row = inserted[0];
  if (!row) return;

  const sent = await ctx.mailer.send({
    to: NEXORA_INBOX,
    subject: args.subject,
    text: args.body,
  });
  const now = new Date();
  await db
    .update(schema.notificationEmails)
    .set({
      status: sent.ok ? "envoye" : "echec",
      error: sent.ok ? "" : sent.error,
      sentAt: sent.ok ? now : null,
      updatedAt: now,
    })
    .where(eq(schema.notificationEmails.id, row.id));
}

function supportRow(row: typeof schema.supportMessages.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function serverRow(row: typeof schema.serverRequests.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    serverName: row.serverName,
    plan: row.plan,
    theme: row.theme,
    priceCents: row.priceCents,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

const errorResponse = z.object({
  ok: z.literal(false),
  error: z.string(),
});

const userObj = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  role: z.string(),
  createdAt: z.string(),
  discordId: z.string().nullable(),
  discordUsername: z.string(),
  discordAvatar: z.string(),
});

// ---------------------------------------------------------------------------
// Shared response shapes
// ---------------------------------------------------------------------------

const authResponse = z.union([
  z.object({
    ok: z.literal(true),
    token: z.string(),
    user: userObj,
  }),
  errorResponse,
]);
type AuthResult = z.infer<typeof authResponse>;

// Réponse de completeDiscordLogin : soit une session directe (le compte
// Discord était déjà lié), soit une liaison en attente de confirmation.
const discordCompleteResponse = z.union([
  z.object({
    ok: z.literal(true),
    kind: z.literal("login"),
    token: z.string(),
    user: userObj,
  }),
  z.object({
    ok: z.literal(true),
    kind: z.literal("link"),
    pendingToken: z.string(),
    discordUsername: z.string(),
  }),
  errorResponse,
]);
type DiscordCompleteResult = z.infer<typeof discordCompleteResponse>;

// ---------------------------------------------------------------------------
// Discord OAuth2 (application « sniko », Client ID public)
// ---------------------------------------------------------------------------

const DISCORD_CLIENT_ID = "1571508442114560112";
const DISCORD_TTL_MS = 10 * 60 * 1000;

// LE compte Patron : seul le compte inscrit avec CETTE adresse e-mail
// reçoit le rôle Patron (à l'inscription). Jamais via le pseudo —
// l'ancien trou (pseudo « sniko » = Patron) est fermé. Aucun mot de
// passe n'est codé ici : il est choisi par le propriétaire du compte
// lors de son inscription, comme pour tout le monde.
const PATRON_EMAIL = "isaac.201294dz@gmail.com";

async function getDiscordConfig(db: Db) {
  const rows = await db.select().from(schema.discordConfig).limit(1);
  return rows[0] ?? null;
}

// Configuration Discord effective : les variables d'environnement
// (DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI, lues sur l'hôte via le
// handler privilégié readEnv) sont PRIORITAIRES ; à défaut, on prend les
// valeurs enregistrées par le Patron dans le panneau admin (table
// discord_config). Le secret ne sort jamais vers un client.
async function resolveDiscordSettings(ctx: Ctx, db: Db) {
  const config = await getDiscordConfig(db);
  const envSecret = await ctx.executePrivileged(privileged.readEnv, {
    name: "DISCORD_CLIENT_SECRET",
  });
  const envRedirect = await ctx.executePrivileged(privileged.readEnv, {
    name: "DISCORD_REDIRECT_URI",
  });
  return {
    clientSecret: envSecret.value || config?.clientSecret || "",
    redirectUri: envRedirect.value || config?.redirectUri || "",
    secretFromEnv: envSecret.value.length > 0,
    redirectFromEnv: envRedirect.value.length > 0,
  };
}

// Clé API du bot (endpoint de synchro des rôles) : variable
// d'environnement NEXORA_API_KEY prioritaire, sinon la clé enregistrée
// par le Patron dans le panneau admin. Chaîne vide = aucune clé
// configurée = l'endpoint refuse tout le monde.
async function resolveBotApiKey(ctx: Ctx, db: Db): Promise<string> {
  const envKey = await ctx.executePrivileged(privileged.readEnv, {
    name: "NEXORA_API_KEY",
  });
  if (envKey.value) return envKey.value;
  const config = await getDiscordConfig(db);
  return config?.apiKey ?? "";
}

// Offre actuelle d'un utilisateur : son abonnement bot ACTIF le plus
// récent (statut actif et non expiré), sinon "gratuit" — tout le monde a
// donc toujours une offre, gratuite par défaut.
type PlanKey = "gratuit" | "premium" | "premium_plus" | "annuel";

async function currentPlanKey(db: Db, userId: number): Promise<PlanKey> {
  const now = Date.now();
  const rows = await db
    .select()
    .from(schema.botSubscriptions)
    .where(
      and(
        eq(schema.botSubscriptions.userId, userId),
        eq(schema.botSubscriptions.status, "actif"),
      ),
    )
    .orderBy(desc(schema.botSubscriptions.id));
  const active = rows.find((r) => r.endsAt !== null && r.endsAt.getTime() > now);
  return active ? active.plan : "gratuit";
}

// Mapping vers les noms d'offres attendus par le bot Discord :
// gratuit → free, premium → premium, premium_plus → premium+,
// annuel → annuelle.
const PLAN_API_NAME: Record<PlanKey, string> = {
  gratuit: "free",
  premium: "premium",
  premium_plus: "premium+",
  annuel: "annuelle",
};

const DISCORD_NOT_CONFIGURED =
  "La connexion Discord n'est pas encore activée : le Patron doit d'abord enregistrer le Client Secret et l'adresse de retour (onglet Patron).";
const DISCORD_EXPIRED = "La demande de connexion Discord a expiré. Recommence.";

const okResponse = z.union([z.object({ ok: z.literal(true) }), errorResponse]);
type OkResult = z.infer<typeof okResponse>;

const sendResponse = z.union([
  z.object({
    ok: z.literal(true),
    deliveryId: z.number(),
    status: z.string(),
  }),
  errorResponse,
]);
type SendResult = z.infer<typeof sendResponse>;

const SHA = [privileged.sha256];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const Actions = {
  requestSignupCode: defineAction({
    description:
      "Generates a real 6-digit signup verification code, invalidates any previous pending code for that e-mail (only one active code per address), stores it hashed server-side with a 10-minute expiry, and sends it for real by e-mail (HTML e-mail in the classic verification layout: NEXORA header, greeting, and the code in large digits inside a light box) by SMTP through the nexora.activate@gmail.com Gmail account (Nodemailer, GMAIL_APP_PASSWORD). The delivery row is marked envoye or echec from the SMTP result. The code is never returned to the client. Refuses an e-mail that already has an account ('Cette adresse e-mail est déjà utilisée.') and enforces a 30-second cooldown between two code sends to the same address.",
    request: z.object({ email: z.string().max(200) }),
    response: sendResponse,
    privileged: [privileged.randomCode, privileged.sha256],
    async handler(ctx, args): Promise<SendResult> {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return { ok: false, error: "Cette adresse e-mail n'est pas valide." };
      }
      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existing[0]) {
        return { ok: false, error: "Cette adresse e-mail est déjà utilisée." };
      }
      // Anti-spam : un seul code toutes les 30 secondes pour cette adresse.
      // On regarde le dernier code créé pour l'e-mail (utilisé ou non) :
      // s'il a moins de 30 secondes, on refuse le nouvel envoi.
      const recentCodes = await db
        .select()
        .from(schema.verificationCodes)
        .where(eq(schema.verificationCodes.email, email))
        .orderBy(desc(schema.verificationCodes.id))
        .limit(1);
      const lastCode = recentCodes[0];
      if (lastCode && Date.now() - lastCode.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        return {
          ok: false,
          error: "Tu dois attendre 30 secondes avant de renvoyer un code.",
        };
      }
      const { code } = await ctx.executePrivileged(privileged.randomCode, {});
      const insertedCodes = await db
        .insert(schema.verificationCodes)
        .values({
          email,
          codeHash: await sha(ctx, code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        })
        .returning();
      const codeRow = insertedCodes[0];
      if (!codeRow) {
        return { ok: false, error: "La création du code a échoué. Réessaie." };
      }
      // Un seul code actif par e-mail : tout ancien code encore en attente
      // est invalidé APRÈS la création du nouveau. Seul le code envoyé dans
      // le nouvel e-mail pourra créer le compte — aucun autre code, ancien
      // ou inventé, ne passe.
      await db
        .update(schema.verificationCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(schema.verificationCodes.email, email),
            isNull(schema.verificationCodes.usedAt),
            ne(schema.verificationCodes.id, codeRow.id),
          ),
        );
      const insertedDeliveries = await db
        .insert(schema.emailDeliveries)
        .values({ email, codeId: codeRow.id, status: "en_cours" })
        .returning();
      const delivery = insertedDeliveries[0];
      if (!delivery) {
        return { ok: false, error: "L'envoi du code a échoué. Réessaie." };
      }

      const subject = "Ton code de vérification NEXORA";
      // E-mail HTML sur le modèle des e-mails de vérification classiques
      // (type Meta) : en-tête NEXORA, « Bonjour, », une phrase claire, le
      // code en très gros chiffres espacés dans un encadré gris clair,
      // puis la phrase d'ignore et un pied de page discret.
      const htmlBody = [
        "<!DOCTYPE html>",
        '<html lang="fr">',
        "<body style=\"margin:0;padding:0;background-color:#ffffff;\">",
        '<div style="max-width:600px;margin:0 auto;padding:36px 28px;font-family:Arial,Helvetica,sans-serif;color:#1c1e21;">',
        '<div style="font-size:30px;font-weight:900;letter-spacing:3px;color:#000000;">NEXORA</div>',
        '<div style="border-top:1px solid #dddfe2;margin:18px 0 26px;"></div>',
        '<p style="font-size:16px;margin:0 0 16px;">Bonjour,</p>',
        '<p style="font-size:16px;line-height:1.5;margin:0 0 22px;">Tu peux créer ton compte NEXORA en entrant le code suivant sur le site :</p>',
        '<p style="font-size:15px;margin:0 0 8px;">Code de vérification</p>',
        `<div style="background-color:#f0f2f5;border-radius:8px;padding:22px 24px;font-size:34px;font-weight:700;letter-spacing:10px;color:#1c1e21;">${code}</div>`,
        '<p style="font-size:16px;line-height:1.5;margin:22px 0 0;">Le code expire dans 10 minutes. Si tu n\'as pas demandé ce code, tu peux ignorer cet e-mail.</p>',
        '<div style="border-top:1px solid #dddfe2;margin:26px 0 14px;"></div>',
        '<p style="font-size:12px;line-height:1.5;color:#606770;margin:0;">Ce message a été envoyé par NEXORA à ta demande, pour vérifier ton adresse e-mail lors de la création de ton compte.</p>',
        "</div>",
        "</body>",
        "</html>",
      ].join("\n");

      // Envoi réel par SMTP (Nodemailer, compte Gmail
      // nexora.activate@gmail.com) puis marquage de la livraison selon le
      // résultat : envoye (avec l'heure) ou echec (avec l'erreur SMTP).
      const sent = await ctx.mailer.send({ to: email, subject, html: htmlBody });
      const now = new Date();
      await db
        .update(schema.emailDeliveries)
        .set({
          status: sent.ok ? "envoye" : "echec",
          error: sent.ok ? "" : sent.error,
          sentAt: sent.ok ? now : null,
          updatedAt: now,
        })
        .where(eq(schema.emailDeliveries.id, delivery.id));
      if (!sent.ok) {
        return {
          ok: false,
          error: "L'envoi de l'e-mail a échoué. Réessaie dans un instant.",
        };
      }
      return { ok: true, deliveryId: delivery.id, status: "envoye" };
    },
  }),

  markCodeEmailDelivered: defineAction({
    description:
      "Marks a signup-code e-mail delivery as sent (envoye) or failed (echec) in the delivery tracking table. The SMTP send in requestSignupCode already marks the row from its own result; this action remains available to correct a delivery status.",
    request: z.object({
      deliveryId: z.number().int().positive(),
      sent: z.boolean(),
      error: z.string().max(1000).optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db
        .update(schema.emailDeliveries)
        .set({
          status: args.sent ? "envoye" : "echec",
          error: args.sent ? "" : (args.error ?? "Échec d'envoi inconnu."),
          sentAt: args.sent ? now : null,
          updatedAt: now,
        })
        .where(eq(schema.emailDeliveries.id, args.deliveryId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  markNotificationEmailDelivered: defineAction({
    description:
      "Marks a NEXORA notification e-mail (support message or server request sent to the NEXORA address) as sent (envoye) or failed (echec) in the delivery tracking table. The SMTP send already marks the row from its own result; this action remains available to correct a delivery status.",
    request: z.object({
      deliveryId: z.number().int().positive(),
      sent: z.boolean(),
      error: z.string().max(1000).optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db
        .update(schema.notificationEmails)
        .set({
          status: args.sent ? "envoye" : "echec",
          error: args.sent ? "" : (args.error ?? "Échec d'envoi inconnu."),
          sentAt: args.sent ? now : null,
          updatedAt: now,
        })
        .where(eq(schema.notificationEmails.id, args.deliveryId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getCodeDeliveryStatus: defineAction({
    description:
      "Returns the delivery status of the latest signup-code e-mail for an address: en_cours, envoye, echec, or aucun (none).",
    request: z.object({ email: z.string().max(200) }),
    response: z.object({
      status: z.enum(["en_cours", "envoye", "echec", "aucun"]),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      const rows = await db
        .select()
        .from(schema.emailDeliveries)
        .where(eq(schema.emailDeliveries.email, email))
        .orderBy(desc(schema.emailDeliveries.id))
        .limit(1);
      const row = rows[0];
      return { status: row ? row.status : ("aucun" as const) };
    },
  }),

  register: defineAction({
    description:
      "Creates a real user account after verifying the 6-digit code, hashes the password, and opens a session. The Patron role goes ONLY to the account registered with the Patron e-mail address (isaac.201294dz@gmail.com) — never to a username: registering as 'sniko' grants nothing (the UI shows the 'voleur' easter egg for that username instead). The password must be 8 to 12 characters long and contain between 1 and 5 digits; an e-mail that already has an account is refused with 'Cette adresse e-mail est déjà utilisée.'.",
    request: z.object({
      username: z.string().max(200),
      email: z.string().max(200),
      password: z.string().min(1).max(100),
      code: z.string().max(20),
    }),
    response: authResponse,
    privileged: [privileged.sha256, privileged.hashNewPassword, privileged.randomToken],
    async handler(ctx, args): Promise<AuthResult> {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      const username = args.username.trim();
      const typedCode = args.code.trim();

      // Validations de format DANS le handler, avec des messages clairs :
      // avant, un pseudo trop court/long ou un e-mail mal formé faisaient
      // échouer la requête entière et l'écran n'affichait qu'une erreur
      // générique (« Ça n'a pas marché ») — l'« erreur dans le pseudo ».
      if (!EMAIL_RE.test(email)) {
        return { ok: false, error: "Cette adresse e-mail n'est pas valide." };
      }
      if (username.length < 2 || username.length > 30) {
        return {
          ok: false,
          error: "Ton pseudo doit faire entre 2 et 30 caractères.",
        };
      }
      if (!/^[0-9]{6}$/.test(typedCode)) {
        return { ok: false, error: "Ce code n'est pas le bon. Vérifie et réessaie." };
      }

      const byEmail = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (byEmail[0]) return { ok: false, error: "Cette adresse e-mail est déjà utilisée." };
      // Règles du mot de passe, vérifiées AVANT le code pour ne pas brûler
      // un essai de code quand seul le mot de passe est mauvais :
      // entre 8 et 12 caractères, avec 1 à 5 chiffres.
      if (args.password.length < 8 || args.password.length > 12) {
        return {
          ok: false,
          error: "Le mot de passe doit faire entre 8 et 12 caractères.",
        };
      }
      const digitCount = (args.password.match(/[0-9]/g) ?? []).length;
      if (digitCount < 1 || digitCount > 5) {
        return {
          ok: false,
          error: "Le mot de passe doit contenir entre 1 et 5 chiffres.",
        };
      }
      const byName = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, username))
        .limit(1);
      if (byName[0]) return { ok: false, error: "Ce pseudo est déjà pris. Choisis-en un autre." };

      const codes = await db
        .select()
        .from(schema.verificationCodes)
        .where(
          and(
            eq(schema.verificationCodes.email, email),
            isNull(schema.verificationCodes.usedAt),
          ),
        )
        .orderBy(desc(schema.verificationCodes.id))
        .limit(1);
      const codeRow = codes[0];
      if (!codeRow) {
        return { ok: false, error: "Aucun code en attente pour cet e-mail. Redemande un code." };
      }
      if (codeRow.expiresAt.getTime() <= Date.now()) {
        return { ok: false, error: "Ce code a expiré (10 minutes). Redemande un code." };
      }
      if (codeRow.attempts >= 5) {
        return { ok: false, error: "Trop d'essais avec ce code. Redemande un code." };
      }
      if ((await sha(ctx, typedCode)) !== codeRow.codeHash) {
        await db
          .update(schema.verificationCodes)
          .set({ attempts: codeRow.attempts + 1 })
          .where(eq(schema.verificationCodes.id, codeRow.id));
        return { ok: false, error: "Ce code n'est pas le bon. Vérifie et réessaie." };
      }
      await db
        .update(schema.verificationCodes)
        .set({ usedAt: new Date() })
        .where(eq(schema.verificationCodes.id, codeRow.id));
      // Défense en profondeur : après une inscription réussie, aucun autre
      // code en attente pour cet e-mail ne reste utilisable.
      await db
        .update(schema.verificationCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(schema.verificationCodes.email, email),
            isNull(schema.verificationCodes.usedAt),
          ),
        );

      const { hash, salt } = await ctx.executePrivileged(privileged.hashNewPassword, {
        password: args.password,
      });
      // Rôle Patron : UNIQUEMENT l'adresse e-mail du Patron (voir
      // PATRON_EMAIL). Le pseudo ne donne plus aucun rôle — fini le trou
      // où n'importe qui devenait Patron en tapant « sniko ».
      const role = email === PATRON_EMAIL ? "patron" : "membre";
      const inserted = await db
        .insert(schema.users)
        .values({ username, email, passwordHash: hash, passwordSalt: salt, role })
        .returning();
      const user = inserted[0];
      if (!user) return { ok: false, error: "La création du compte a échoué. Réessaie." };
      const token = await createSession(ctx, db, user.id);
      ctx.invalidateQueries();
      return { ok: true, token, user: publicUser(user) };
    },
  }),

  login: defineAction({
    description: "Logs a user in with e-mail and password and returns a session token.",
    request: z.object({
      email: z.string().max(200),
      password: z.string().min(1).max(100),
    }),
    response: authResponse,
    privileged: [privileged.verifyPassword, privileged.randomToken, privileged.sha256],
    async handler(ctx, args): Promise<AuthResult> {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return { ok: false, error: "E-mail ou mot de passe incorrect." };
      }
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      if (!user) return { ok: false, error: "E-mail ou mot de passe incorrect." };
      const check = await ctx.executePrivileged(privileged.verifyPassword, {
        password: args.password,
        salt: user.passwordSalt,
        expectedHash: user.passwordHash,
      });
      if (!check.ok) return { ok: false, error: "E-mail ou mot de passe incorrect." };
      const token = await createSession(ctx, db, user.id);
      return { ok: true, token, user: publicUser(user) };
    },
  }),

  logout: defineAction({
    description: "Logs the current session out.",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({ ok: z.literal(true) }),
    privileged: SHA,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.tokenHash, await sha(ctx, args.token)));
      return { ok: true };
    },
  }),

  getSession: defineAction({
    description: "Returns the logged-in user for a session token, or null.",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      user: userObj.nullable(),
    }),
    privileged: SHA,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, db, args.token);
      return { user: user ? publicUser(user) : null };
    },
  }),

  startDiscordLogin: defineAction({
    description:
      "Starts the real Discord OAuth2 flow for the 'sniko' application (Client ID 1571508442114560112): stores a hashed one-time state (10-minute expiry, bound to the logged-in user when a session token is given) and returns the discord.com authorize URL (scope identify) the browser must open. The redirect URI comes from the DISCORD_REDIRECT_URI environment variable when set, otherwise from the value the Patron saved in the admin dashboard. Fails with a clear 'Discord login not configured' message while neither a Client Secret nor a redirect URI is configured (environment or admin dashboard).",
    request: z.object({ token: z.string().max(200).optional() }),
    response: z.union([
      z.object({ ok: z.literal(true), url: z.string() }),
      errorResponse,
    ]),
    privileged: [privileged.randomToken, privileged.sha256, privileged.readEnv],
    async handler(ctx, args): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
      const db = ctx.db<typeof schema>();
      const settings = await resolveDiscordSettings(ctx, db);
      if (!settings.clientSecret || !settings.redirectUri) {
        return { ok: false, error: DISCORD_NOT_CONFIGURED };
      }
      let userId: number | null = null;
      if (args.token) {
        const user = await requireUser(ctx, db, args.token);
        if (user) userId = user.id;
      }
      const { token: state } = await ctx.executePrivileged(privileged.randomToken, {});
      await db.insert(schema.discordLoginCodes).values({
        stateHash: await sha(ctx, state),
        userId,
        expiresAt: new Date(Date.now() + DISCORD_TTL_MS),
      });
      const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        response_type: "code",
        redirect_uri: settings.redirectUri,
        scope: "identify",
        state,
        prompt: "consent",
      });
      return {
        ok: true,
        url: `https://discord.com/oauth2/authorize?${params.toString()}`,
      };
    },
  }),

  completeDiscordLogin: defineAction({
    description:
      "Handles the Discord OAuth2 redirect back to NEXORA: validates the one-time state, exchanges the authorization code for the Discord identity (id, username, avatar) via the privileged host handler (Client Secret never leaves the server; it comes from the DISCORD_CLIENT_SECRET environment variable when set, otherwise from the admin-saved config), then either logs the owner in directly when that Discord account is already linked to a NEXORA account, or holds the identity behind a hashed pending token so the user can explicitly confirm the link with confirmDiscordLink.",
    request: z.object({
      code: z.string().min(1).max(500),
      state: z.string().min(1).max(200),
    }),
    response: discordCompleteResponse,
    privileged: [
      privileged.sha256,
      privileged.discordOAuthExchange,
      privileged.randomToken,
      privileged.readEnv,
    ],
    async handler(ctx, args): Promise<DiscordCompleteResult> {
      const db = ctx.db<typeof schema>();
      const stateRows = await db
        .select()
        .from(schema.discordLoginCodes)
        .where(eq(schema.discordLoginCodes.stateHash, await sha(ctx, args.state)))
        .limit(1);
      const stateRow = stateRows[0];
      if (
        !stateRow ||
        stateRow.usedAt ||
        stateRow.expiresAt.getTime() <= Date.now()
      ) {
        return { ok: false, error: DISCORD_EXPIRED };
      }
      const settings = await resolveDiscordSettings(ctx, db);
      if (!settings.clientSecret || !settings.redirectUri) {
        return { ok: false, error: DISCORD_NOT_CONFIGURED };
      }
      const identity = await ctx.executePrivileged(privileged.discordOAuthExchange, {
        code: args.code,
        clientId: DISCORD_CLIENT_ID,
        clientSecret: settings.clientSecret,
        redirectUri: settings.redirectUri,
      });
      if (!identity.ok) {
        return { ok: false, error: "Discord a refusé la connexion. Réessaie." };
      }
      // Le state est consommé dès que Discord a répondu : ni le code ni
      // le state ne peuvent être rejoués.
      await db
        .update(schema.discordLoginCodes)
        .set({ usedAt: new Date() })
        .where(eq(schema.discordLoginCodes.id, stateRow.id));
      const discordName = identity.globalName || identity.username;
      // Compte Discord déjà lié → connexion directe, sans confirmation :
      // la liaison a déjà été approuvée par l'utilisateur dans le passé.
      // On rafraîchit au passage le pseudo et l'avatar stockés.
      const linked = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.discordId, identity.discordId))
        .limit(1);
      const linkedUser = linked[0];
      if (linkedUser) {
        await db
          .update(schema.users)
          .set({ discordUsername: discordName, discordAvatar: identity.avatar })
          .where(eq(schema.users.id, linkedUser.id));
        const token = await createSession(ctx, db, linkedUser.id);
        ctx.invalidateQueries();
        return {
          ok: true,
          kind: "login",
          token,
          user: publicUser({
            ...linkedUser,
            discordUsername: discordName,
            discordAvatar: identity.avatar,
          }),
        };
      }
      // Nouveau compte Discord : on garde l'identité derrière un jeton
      // d'attente (stocké hashé, 10 minutes) et RIEN n'est lié tant que
      // l'utilisateur n'a pas confirmé explicitement.
      const { token: pendingToken } = await ctx.executePrivileged(
        privileged.randomToken,
        {},
      );
      await db.insert(schema.discordLoginCodes).values({
        userId: stateRow.userId,
        pendingTokenHash: await sha(ctx, pendingToken),
        discordId: identity.discordId,
        discordUsername: discordName,
        discordAvatar: identity.avatar,
        discordEmail: identity.email ?? "",
        expiresAt: new Date(Date.now() + DISCORD_TTL_MS),
      });
      return {
        ok: true,
        kind: "link",
        pendingToken,
        discordUsername: discordName,
      };
    },
  }),

  confirmDiscordLink: defineAction({
    description:
      "Links a Discord identity held by completeDiscordLogin to a NEXORA account, only after the user's explicit confirmation. The target account is the logged-in user when a session token is given, otherwise the user who started the flow from their dashboard. Refuses when that Discord account is already linked to another NEXORA account, or when the target account is already linked to a different Discord account. Returns a fresh session for the linked account.",
    request: z.object({
      pendingToken: z.string().min(1).max(200),
      token: z.string().max(200).optional(),
    }),
    response: authResponse,
    privileged: [privileged.sha256, privileged.randomToken],
    async handler(ctx, args): Promise<AuthResult> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.discordLoginCodes)
        .where(
          eq(
            schema.discordLoginCodes.pendingTokenHash,
            await sha(ctx, args.pendingToken),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
        return { ok: false, error: DISCORD_EXPIRED };
      }
      // À quel compte NEXORA lier ? L'utilisateur connecté qui confirme,
      // ou celui qui avait démarré le flux depuis son tableau de bord.
      let target: AuthedUser | null = null;
      if (args.token) target = await requireUser(ctx, db, args.token);
      if (!target && row.userId) {
        const bound = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, row.userId))
          .limit(1);
        target = bound[0] ?? null;
      }
      if (!target) {
        return {
          ok: false,
          error:
            "Connecte-toi d'abord à ton compte NEXORA, puis confirme la connexion Discord.",
        };
      }
      const others = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.discordId, row.discordId))
        .limit(1);
      const other = others[0];
      if (other && other.id !== target.id) {
        return {
          ok: false,
          error: "Ce compte Discord est déjà connecté à un autre compte NEXORA.",
        };
      }
      if (target.discordId && target.discordId !== row.discordId) {
        return {
          ok: false,
          error: "Ton compte NEXORA est déjà connecté à un autre compte Discord.",
        };
      }
      await db
        .update(schema.users)
        .set({
          discordId: row.discordId,
          discordUsername: row.discordUsername,
          discordAvatar: row.discordAvatar,
        })
        .where(eq(schema.users.id, target.id));
      await db
        .update(schema.discordLoginCodes)
        .set({ usedAt: new Date() })
        .where(eq(schema.discordLoginCodes.id, row.id));
      const updatedRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, target.id))
        .limit(1);
      const updated = updatedRows[0] ?? target;
      const token = await createSession(ctx, db, updated.id);
      ctx.invalidateQueries();
      return { ok: true, token, user: publicUser(updated) };
    },
  }),

  cancelDiscordLink: defineAction({
    description:
      "Cancels a pending Discord link (the user answered No to the confirmation): the held Discord identity is discarded and can never be linked from that pending token.",
    request: z.object({ pendingToken: z.string().min(1).max(200) }),
    response: z.object({ ok: z.literal(true) }),
    privileged: SHA,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.discordLoginCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(
              schema.discordLoginCodes.pendingTokenHash,
              await sha(ctx, args.pendingToken),
            ),
            isNull(schema.discordLoginCodes.usedAt),
          ),
        );
      return { ok: true };
    },
  }),

  getMyStuff: defineAction({
    description:
      "Returns the logged-in user's server requests and bot subscriptions, newest first, plus premiumUnlocked: true when the user has an active paid bot plan (or is Patron), which unlocks Premium server creation, and currentPlan: the user's current plan (their active bot subscription's plan, or 'gratuit' when none is active).",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      premiumUnlocked: z.boolean(),
      currentPlan: z.enum(["gratuit", "premium", "premium_plus", "annuel"]),
      servers: z.array(
        z.object({
          id: z.number(),
          userId: z.number(),
          serverName: z.string(),
          plan: z.string(),
          theme: z.string(),
          priceCents: z.number(),
          status: z.string(),
          createdAt: z.string(),
        }),
      ),
      bots: z.array(
        z.object({
          id: z.number(),
          userId: z.number(),
          plan: z.string(),
          priceCents: z.number(),
          status: z.string(),
          startsAt: z.string().nullable(),
          endsAt: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
    }),
    privileged: SHA,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, db, args.token);
      if (!user) {
        return {
          premiumUnlocked: false,
          currentPlan: "gratuit" as const,
          servers: [],
          bots: [],
        };
      }
      const servers = await db
        .select()
        .from(schema.serverRequests)
        .where(eq(schema.serverRequests.userId, user.id))
        .orderBy(desc(schema.serverRequests.id));
      const bots = await db
        .select()
        .from(schema.botSubscriptions)
        .where(eq(schema.botSubscriptions.userId, user.id))
        .orderBy(desc(schema.botSubscriptions.id));
      const premiumUnlocked =
        user.role === "patron" || (await hasActivePaidBot(db, user.id));
      return {
        premiumUnlocked,
        currentPlan: await currentPlanKey(db, user.id),
        servers: servers.map(serverRow),
        bots: bots.map(botRow),
      };
    },
  }),

  requestServer: defineAction({
    description:
      "Records a Discord server creation request and notifies the NEXORA address by real e-mail (nexora.activate@gmail.com, by SMTP). The Demo is free for everyone. The Premium server is unlocked only by an active paid bot plan (Premium, Premium+ or Annual) or the Patron role — checked server-side on every request — and is then included at no extra cost, going straight into the build queue.",
    request: z.object({
      token: z.string().min(1),
      serverName: z.string().trim().min(2).max(60),
      plan: z.enum(["demo", "premium"]),
      theme: z.string().trim().max(200).default(""),
    }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, db, args.token);
      if (!user) return { ok: false, error: "Tu n'es plus connecté. Reconnecte-toi." };
      // Déblocage Premium vérifié ICI, côté serveur, à chaque demande :
      // impossible de l'obtenir en modifiant l'interface ou une URL.
      if (args.plan === "premium") {
        const unlocked =
          user.role === "patron" || (await hasActivePaidBot(db, user.id));
        if (!unlocked) {
          return {
            ok: false,
            error:
              "Le serveur Premium se débloque avec une offre payante (Premium, Premium+ ou Annuelle).",
          };
        }
      }
      const price = SERVER_PRICE[args.plan] ?? 0;
      const serverName = args.serverName.trim();
      const theme = args.theme.trim();
      await db.insert(schema.serverRequests).values({
        userId: user.id,
        serverName,
        plan: args.plan,
        theme,
        priceCents: price,
        status: "en_attente",
      });
      // La demande part aussi en vrai par e-mail à l'adresse NEXORA.
      await notifyNexora(ctx, db, {
        kind: "serveur",
        userId: user.id,
        subject: `NEXORA — Nouvelle demande de serveur : ${serverName}`,
        body: [
          "Nouvelle demande de création de serveur Discord sur NEXORA.",
          "",
          `De : ${user.username} (${user.email})`,
          `Nom du serveur : ${serverName}`,
          `Offre : ${args.plan === "premium" ? "Premium" : "Démo"}`,
          theme ? `Thème : ${theme}` : "Thème : (aucun)",
          "",
          "La demande est aussi visible dans le tableau de bord Patron de NEXORA.",
        ].join("\n"),
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  activateBotFree: defineAction({
    description:
      "Activates sniko bot free for 24 hours after the ad screen, or extends the current free activation by 24 hours.",
    request: z.object({ token: z.string().min(1) }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, db, args.token);
      if (!user) return { ok: false, error: "Tu n'es plus connecté. Reconnecte-toi." };
      const now = Date.now();
      const rows = await db
        .select()
        .from(schema.botSubscriptions)
        .where(
          and(
            eq(schema.botSubscriptions.userId, user.id),
            eq(schema.botSubscriptions.status, "actif"),
          ),
        )
        .orderBy(desc(schema.botSubscriptions.id));
      const activePaid = rows.find(
        (r) => r.plan !== "gratuit" && r.endsAt && r.endsAt.getTime() > now,
      );
      if (activePaid) {
        return {
          ok: false,
          error: "Tu as déjà un bot Premium actif. Pas besoin de publicité.",
        };
      }
      const activeFree = rows.find(
        (r) => r.plan === "gratuit" && r.endsAt && r.endsAt.getTime() > now,
      );
      if (activeFree && activeFree.endsAt) {
        await db
          .update(schema.botSubscriptions)
          .set({
            endsAt: new Date(activeFree.endsAt.getTime() + DAY_MS),
            updatedAt: new Date(),
          })
          .where(eq(schema.botSubscriptions.id, activeFree.id));
      } else {
        await db.insert(schema.botSubscriptions).values({
          userId: user.id,
          plan: "gratuit",
          priceCents: 0,
          status: "actif",
          startsAt: new Date(now),
          endsAt: new Date(now + DAY_MS),
        });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  orderBotPlan: defineAction({
    description:
      "Creates a pending-payment order for a paid bot plan: Premium (3,99 €, 1 month), Premium+ (10 €, 5 months) or Annual (30 €, 1 year); Premium+ and Annual carry the same benefits as Premium. The Patron validates it in the admin dashboard, which starts the real duration and unlocks Premium features server-side.",
    request: z.object({
      token: z.string().min(1),
      plan: z.enum(["premium", "premium_plus", "annuel"]),
    }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, db, args.token);
      if (!user) return { ok: false, error: "Tu n'es plus connecté. Reconnecte-toi." };
      const pending = await db
        .select()
        .from(schema.botSubscriptions)
        .where(
          and(
            eq(schema.botSubscriptions.userId, user.id),
            eq(schema.botSubscriptions.status, "en_attente_paiement"),
          ),
        )
        .limit(1);
      if (pending[0]) {
        return {
          ok: false,
          error: "Tu as déjà une commande en attente de validation.",
        };
      }
      await db.insert(schema.botSubscriptions).values({
        userId: user.id,
        plan: args.plan,
        priceCents: BOT_PRICE[args.plan] ?? 0,
        status: "en_attente_paiement",
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // -------------------------------------------------------------------------
  // Admin (Patron only)
  // -------------------------------------------------------------------------

  adminOverview: defineAction({
    description:
      "Patron only: counts of users, server requests and bot subscriptions, plus total validated revenue in cents.",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      allowed: z.boolean(),
      users: z.number(),
      serversTotal: z.number(),
      serversPending: z.number(),
      botsActive: z.number(),
      botsPending: z.number(),
      revenueCents: z.number(),
    }),
    privileged: SHA,
    async handler(ctx, args) {
      const empty = {
        allowed: false,
        users: 0,
        serversTotal: 0,
        serversPending: 0,
        botsActive: 0,
        botsPending: 0,
        revenueCents: 0,
      };
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return empty;
      const now = Date.now();
      const allUsers = await db.select().from(schema.users);
      const allServers = await db.select().from(schema.serverRequests);
      const allBots = await db.select().from(schema.botSubscriptions);
      const revenue =
        allServers
          .filter((s) => s.status !== "en_attente_paiement" && s.status !== "annule")
          .reduce((sum, s) => sum + s.priceCents, 0) +
        allBots
          .filter((b) => b.status === "actif")
          .reduce((sum, b) => sum + b.priceCents, 0);
      return {
        allowed: true,
        users: allUsers.length,
        serversTotal: allServers.length,
        serversPending: allServers.filter(
          (s) => s.status === "en_attente_paiement" || s.status === "en_attente",
        ).length,
        botsActive: allBots.filter(
          (b) => b.status === "actif" && b.endsAt && b.endsAt.getTime() > now,
        ).length,
        botsPending: allBots.filter((b) => b.status === "en_attente_paiement").length,
        revenueCents: revenue,
      };
    },
  }),

  adminListUsers: defineAction({
    description:
      "Patron only: lists every registered user, newest first, each with their current plan (active bot subscription's plan, or 'gratuit').",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      users: z.array(userObj.extend({ currentPlan: z.string() })),
    }),
    privileged: SHA,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { users: [] };
      const rows = await db
        .select()
        .from(schema.users)
        .orderBy(desc(schema.users.id));
      const users = [];
      for (const row of rows) {
        users.push({
          ...publicUser(row),
          currentPlan: await currentPlanKey(db, row.id),
        });
      }
      return { users };
    },
  }),

  adminListServers: defineAction({
    description: "Patron only: lists every server request with its owner's username.",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      servers: z.array(
        z.object({
          id: z.number(),
          userId: z.number(),
          serverName: z.string(),
          plan: z.string(),
          theme: z.string(),
          priceCents: z.number(),
          status: z.string(),
          createdAt: z.string(),
          ownerName: z.string(),
        }),
      ),
    }),
    privileged: SHA,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { servers: [] };
      const rows = await db
        .select()
        .from(schema.serverRequests)
        .orderBy(desc(schema.serverRequests.id));
      const allUsers = await db.select().from(schema.users);
      const names = new Map(allUsers.map((u) => [u.id, u.username]));
      return {
        servers: rows.map((r) => ({
          ...serverRow(r),
          ownerName: names.get(r.userId) ?? "?",
        })),
      };
    },
  }),

  adminListBots: defineAction({
    description: "Patron only: lists every bot subscription with its owner's username.",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      bots: z.array(
        z.object({
          id: z.number(),
          userId: z.number(),
          plan: z.string(),
          priceCents: z.number(),
          status: z.string(),
          startsAt: z.string().nullable(),
          endsAt: z.string().nullable(),
          createdAt: z.string(),
          ownerName: z.string(),
        }),
      ),
    }),
    privileged: SHA,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { bots: [] };
      const rows = await db
        .select()
        .from(schema.botSubscriptions)
        .orderBy(desc(schema.botSubscriptions.id));
      const allUsers = await db.select().from(schema.users);
      const names = new Map(allUsers.map((u) => [u.id, u.username]));
      return {
        bots: rows.map((r) => ({ ...botRow(r), ownerName: names.get(r.userId) ?? "?" })),
      };
    },
  }),

  adminValidateServerPayment: defineAction({
    description:
      "Patron only: validates payment of a Premium server request, moving it to the build queue.",
    request: z.object({ token: z.string().min(1), id: z.number().int().positive() }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { ok: false, error: "Réservé au Patron." };
      await db
        .update(schema.serverRequests)
        .set({ status: "en_attente", updatedAt: new Date() })
        .where(
          and(
            eq(schema.serverRequests.id, args.id),
            eq(schema.serverRequests.status, "en_attente_paiement"),
          ),
        );
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminSetServerStatus: defineAction({
    description: "Patron only: moves a server request to en_cours, termine or annule.",
    request: z.object({
      token: z.string().min(1),
      id: z.number().int().positive(),
      status: z.enum(["en_cours", "termine", "annule"]),
    }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { ok: false, error: "Réservé au Patron." };
      await db
        .update(schema.serverRequests)
        .set({ status: args.status, updatedAt: new Date() })
        .where(eq(schema.serverRequests.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminValidateBotPayment: defineAction({
    description:
      "Patron only: validates payment of a paid bot order and starts its real duration (Premium 1 month, Premium+ 5 months, Annual 1 year), stacking after any still-active subscription.",
    request: z.object({ token: z.string().min(1), id: z.number().int().positive() }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { ok: false, error: "Réservé au Patron." };
      const rows = await db
        .select()
        .from(schema.botSubscriptions)
        .where(eq(schema.botSubscriptions.id, args.id))
        .limit(1);
      const sub = rows[0];
      if (!sub || sub.status !== "en_attente_paiement") {
        return { ok: false, error: "Cette commande n'est pas en attente de paiement." };
      }
      const now = Date.now();
      const days = BOT_DAYS[sub.plan] ?? 90;
      const actives = await db
        .select()
        .from(schema.botSubscriptions)
        .where(
          and(
            eq(schema.botSubscriptions.userId, sub.userId),
            eq(schema.botSubscriptions.status, "actif"),
          ),
        )
        .orderBy(desc(schema.botSubscriptions.id));
      const latestEnd = actives.reduce<number>((max, r) => {
        const end = r.endsAt ? r.endsAt.getTime() : 0;
        return end > now && end > max ? end : max;
      }, now);
      await db
        .update(schema.botSubscriptions)
        .set({
          status: "actif",
          startsAt: new Date(now),
          endsAt: new Date(latestEnd + days * DAY_MS),
          updatedAt: new Date(),
        })
        .where(eq(schema.botSubscriptions.id, sub.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminCancelBot: defineAction({
    description: "Patron only: cancels a bot subscription immediately.",
    request: z.object({ token: z.string().min(1), id: z.number().int().positive() }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { ok: false, error: "Réservé au Patron." };
      await db
        .update(schema.botSubscriptions)
        .set({ status: "annule", updatedAt: new Date() })
        .where(eq(schema.botSubscriptions.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  sendSupportMessage: defineAction({
    description:
      "Sends a support message from the logged-in user (Contact Support panel): it is stored for the Patron's admin dashboard AND sent for real by e-mail to the NEXORA address (nexora.activate@gmail.com) by SMTP.",
    request: z.object({
      token: z.string().min(1),
      message: z.string().trim().min(3).max(2000),
    }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(ctx, db, args.token);
      if (!user) return { ok: false, error: "Tu n'es plus connecté. Reconnecte-toi." };
      const text = args.message.trim();
      await db.insert(schema.supportMessages).values({
        userId: user.id,
        message: text,
        status: "nouveau",
      });
      // Le message part aussi en vrai par e-mail à l'adresse NEXORA.
      await notifyNexora(ctx, db, {
        kind: "support",
        userId: user.id,
        subject: `NEXORA — Message de support de ${user.username}`,
        body: [
          "Nouveau message de support reçu sur NEXORA.",
          "",
          `De : ${user.username} (${user.email})`,
          "",
          "Message :",
          text,
          "",
          "Le message est aussi visible dans le tableau de bord Patron de NEXORA.",
        ].join("\n"),
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListSupportMessages: defineAction({
    description:
      "Patron only: lists every support message with its author's username, newest first.",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      messages: z.array(
        z.object({
          id: z.number(),
          userId: z.number(),
          message: z.string(),
          status: z.string(),
          createdAt: z.string(),
          ownerName: z.string(),
          ownerEmail: z.string(),
        }),
      ),
    }),
    privileged: SHA,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { messages: [] };
      const rows = await db
        .select()
        .from(schema.supportMessages)
        .orderBy(desc(schema.supportMessages.id));
      const allUsers = await db.select().from(schema.users);
      const byId = new Map(allUsers.map((u) => [u.id, u]));
      return {
        messages: rows.map((r) => ({
          ...supportRow(r),
          ownerName: byId.get(r.userId)?.username ?? "?",
          ownerEmail: byId.get(r.userId)?.email ?? "",
        })),
      };
    },
  }),

  adminHandleSupportMessage: defineAction({
    description: "Patron only: marks a support message as handled (traite) or reopens it (nouveau).",
    request: z.object({
      token: z.string().min(1),
      id: z.number().int().positive(),
      status: z.enum(["nouveau", "traite"]),
    }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { ok: false, error: "Réservé au Patron." };
      await db
        .update(schema.supportMessages)
        .set({ status: args.status, updatedAt: new Date() })
        .where(eq(schema.supportMessages.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminSetRole: defineAction({
    description: "Patron only: promotes a user to patron or demotes them to membre.",
    request: z.object({
      token: z.string().min(1),
      userId: z.number().int().positive(),
      role: z.enum(["membre", "patron"]),
    }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { ok: false, error: "Réservé au Patron." };
      if (args.userId === patron.id && args.role !== "patron") {
        return { ok: false, error: "Tu ne peux pas enlever ton propre rôle Patron." };
      }
      await db
        .update(schema.users)
        .set({ role: args.role })
        .where(eq(schema.users.id, args.userId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminSetUserPlan: defineAction({
    description:
      "Patron only: manually sets a user's plan (no payment involved — plans are granted by hand). Cancels the user's other active bot subscriptions and pending orders, then activates the chosen plan for its real duration starting now: gratuit 24 h, premium 30 days, premium_plus 150 days, annuel 365 days. This is the plan shown on the user's profile and returned to the Discord bot by getDiscordRoles.",
    request: z.object({
      token: z.string().min(1),
      userId: z.number().int().positive(),
      plan: z.enum(["gratuit", "premium", "premium_plus", "annuel"]),
    }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { ok: false, error: "Réservé au Patron." };
      const targets = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, args.userId))
        .limit(1);
      if (!targets[0]) return { ok: false, error: "Utilisateur introuvable." };
      const now = Date.now();
      // Un seul plan actif à la fois : on annule les abonnements actifs
      // et les commandes en attente de cet utilisateur, puis on active
      // le plan choisi pour sa vraie durée.
      await db
        .update(schema.botSubscriptions)
        .set({ status: "annule", updatedAt: new Date() })
        .where(
          and(
            eq(schema.botSubscriptions.userId, args.userId),
            eq(schema.botSubscriptions.status, "actif"),
          ),
        );
      await db
        .update(schema.botSubscriptions)
        .set({ status: "annule", updatedAt: new Date() })
        .where(
          and(
            eq(schema.botSubscriptions.userId, args.userId),
            eq(schema.botSubscriptions.status, "en_attente_paiement"),
          ),
        );
      const days = BOT_DAYS[args.plan] ?? 1;
      await db.insert(schema.botSubscriptions).values({
        userId: args.userId,
        plan: args.plan,
        priceCents: BOT_PRICE[args.plan] ?? 0,
        status: "actif",
        startsAt: new Date(now),
        endsAt: new Date(now + days * DAY_MS),
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getDiscordRoles: defineAction({
    description:
      "Bot API (the GET /api/discord/roles equivalent on this action-based platform): the sniko Discord bot calls it with the NEXORA_API_KEY (the X-Nexora-Api-Key header equivalent — environment variable first, otherwise the key saved by the Patron in the admin dashboard; when no key is configured, everyone is refused, like a 401). Returns { users: [{ discord_id, plan }] } for every user who linked their Discord account, with the plan mapped to free / premium / premium+ / annuelle (the user's active bot subscription, free by default), so the bot can sync the Discord roles.",
    request: z.object({ apiKey: z.string().max(200) }),
    response: z.union([
      z.object({
        ok: z.literal(true),
        users: z.array(
          z.object({ discord_id: z.string(), plan: z.string() }),
        ),
      }),
      errorResponse,
    ]),
    privileged: [privileged.readEnv],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const expected = await resolveBotApiKey(ctx, db);
      if (!expected || args.apiKey !== expected) {
        return { ok: false as const, error: "unauthorized" };
      }
      const rows = await db
        .select()
        .from(schema.users)
        .where(ne(schema.users.discordId, ""))
        .orderBy(schema.users.id);
      const users = [];
      for (const row of rows) {
        if (!row.discordId) continue;
        const plan = await currentPlanKey(db, row.id);
        users.push({ discord_id: row.discordId, plan: PLAN_API_NAME[plan] });
      }
      return { ok: true as const, users };
    },
  }),

  adminGetDatabaseStatus: defineAction({
    description:
      "Patron only: reports the hosting database status — whether DATABASE_URL (the Supabase Postgres connection string) is set in the environment and whether that database answers a SELECT 1 probe from the server. The URL is never returned or logged. DATABASE_URL is the application's real database: without it, database actions cannot run.",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      allowed: z.boolean(),
      databaseUrlSet: z.boolean(),
      reachable: z.boolean(),
    }),
    privileged: [privileged.sha256, privileged.probeDatabase],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) {
        return { allowed: false, databaseUrlSet: false, reachable: false };
      }
      const probe = await ctx.executePrivileged(privileged.probeDatabase, {});
      return {
        allowed: true,
        databaseUrlSet: probe.configured,
        reachable: probe.reachable,
      };
    },
  }),

  adminGetDiscordConfig: defineAction({
    description:
      "Patron only: returns the Discord OAuth + bot API setup state — the public Client ID of the 'sniko' application, the effective redirect URI, whether a Client Secret is available, whether a bot API key is available, and whether each value comes from the environment variables (DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI / NEXORA_API_KEY, which win) or from the admin-saved config. Secrets and keys themselves are never returned.",
    request: z.object({ token: z.string().min(1) }),
    response: z.object({
      allowed: z.boolean(),
      clientId: z.string(),
      redirectUri: z.string(),
      secretSet: z.boolean(),
      secretFromEnv: z.boolean(),
      redirectFromEnv: z.boolean(),
      apiKeySet: z.boolean(),
      apiKeyFromEnv: z.boolean(),
    }),
    privileged: [privileged.sha256, privileged.readEnv],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) {
        return {
          allowed: false,
          clientId: DISCORD_CLIENT_ID,
          redirectUri: "",
          secretSet: false,
          secretFromEnv: false,
          redirectFromEnv: false,
          apiKeySet: false,
          apiKeyFromEnv: false,
        };
      }
      const settings = await resolveDiscordSettings(ctx, db);
      const config = await getDiscordConfig(db);
      const envKey = await ctx.executePrivileged(privileged.readEnv, {
        name: "NEXORA_API_KEY",
      });
      return {
        allowed: true,
        clientId: DISCORD_CLIENT_ID,
        redirectUri: settings.redirectUri,
        secretSet: settings.clientSecret.length > 0,
        secretFromEnv: settings.secretFromEnv,
        redirectFromEnv: settings.redirectFromEnv,
        apiKeySet: envKey.value.length > 0 || (config?.apiKey ?? "").length > 0,
        apiKeyFromEnv: envKey.value.length > 0,
      };
    },
  }),

  adminSaveDiscordConfig: defineAction({
    description:
      "Patron only: saves the Discord OAuth setup — the redirect URI (must start with https:// and must be registered, exactly the same, in the Discord developer portal for the 'sniko' application) and, when non-empty values are provided, the application Client Secret and the bot API key (NEXORA_API_KEY fallback for the roles sync endpoint). Secret and key are stored server-side only and are never returned to any client; leaving a field empty keeps the previously saved value. Environment variables, when set, still take precedence over these saved values.",
    request: z.object({
      token: z.string().min(1),
      redirectUri: z.string().trim().max(500),
      clientSecret: z.string().max(200).optional(),
      apiKey: z.string().max(200).optional(),
    }),
    response: okResponse,
    privileged: SHA,
    async handler(ctx, args): Promise<OkResult> {
      const db = ctx.db<typeof schema>();
      const patron = await requirePatron(ctx, db, args.token);
      if (!patron) return { ok: false, error: "Réservé au Patron." };
      const redirectUri = args.redirectUri.trim();
      if (redirectUri && !redirectUri.startsWith("https://")) {
        return {
          ok: false,
          error: "Adresse de retour invalide : elle doit commencer par https://",
        };
      }
      const newSecret = (args.clientSecret ?? "").trim();
      if (newSecret && newSecret.length < 20) {
        return { ok: false, error: "Le Client Secret semble trop court." };
      }
      const newApiKey = (args.apiKey ?? "").trim();
      if (newApiKey && newApiKey.length < 8) {
        return { ok: false, error: "La clé API semble trop courte." };
      }
      const existing = await getDiscordConfig(db);
      if (existing) {
        await db
          .update(schema.discordConfig)
          .set({
            redirectUri,
            ...(newSecret ? { clientSecret: newSecret } : {}),
            ...(newApiKey ? { apiKey: newApiKey } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.discordConfig.id, existing.id));
      } else {
        await db.insert(schema.discordConfig).values({
          redirectUri,
          clientSecret: newSecret,
          apiKey: newApiKey,
        });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
