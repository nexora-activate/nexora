// Envoi d'e-mails NEXORA — SMTP direct via Nodemailer.
//
// Tous les e-mails de la plateforme partent du compte Gmail
// nexora.activate@gmail.com, en SMTP (smtp.gmail.com:465, TLS) :
//   - les codes d'inscription à 6 chiffres (e-mail HTML),
//   - les notifications au support / demandes de serveur, envoyées à
//     cette même adresse NEXORA.
// Le mot de passe d'application Gmail se lit dans la variable
// d'environnement GMAIL_APP_PASSWORD — jamais en dur dans le code.
// Sans elle, l'envoi échoue proprement ({ ok: false }) et l'appelant
// marque la livraison "echec" avec l'erreur, comme avant.

import nodemailer, { type Transporter } from "nodemailer";

export const NEXORA_MAIL_FROM = "nexora.activate@gmail.com";

export interface MailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export type MailResult = { ok: true } | { ok: false; error: string };

let transporter: Transporter | null = null;

function getTransporter(): Transporter | { error: string } {
  const pass = process.env.GMAIL_APP_PASSWORD?.trim() ?? "";
  if (!pass) {
    return {
      error:
        "GMAIL_APP_PASSWORD n'est pas configuré sur le serveur : l'envoi d'e-mails est impossible.",
    };
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: NEXORA_MAIL_FROM, pass },
    });
  }
  return transporter;
}

// Envoie un e-mail. Ne lève jamais : le résultat dit si le serveur SMTP
// a accepté le message, pour que l'appelant mette à jour le suivi de
// livraison (envoye / echec) dans la base.
export async function sendMail(input: MailInput): Promise<MailResult> {
  const t = getTransporter();
  if ("error" in t) return { ok: false, error: t.error };
  try {
    await t.sendMail({
      from: `NEXORA <${NEXORA_MAIL_FROM}>`,
      to: input.to,
      subject: input.subject,
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
