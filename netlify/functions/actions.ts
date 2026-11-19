// NEXORA — Netlify Function : POST /actions.
//
// Netlify réécrit /actions vers cette fonction (voir netlify.toml).
// Elle partage le handler RPC avec le serveur local
// (server/src/rpc.ts) : mêmes actions, mêmes validations, même format
// de réponse ({ data } / { error }). Runtime Node.js (aucune API Bun).
//
// Format Netlify Functions v1 : la fonction exporte `handler` et reçoit
// un événement (méthode HTTP, en-têtes, corps) ; elle répond avec un
// code de statut, des en-têtes et un corps texte. Les types minimaux
// sont définis ici pour ne pas ajouter de dépendance.
//
// Fonctionnement serverless : la fonction démarre à froid à la première
// requête, se réutilise tant qu'elle reste chaude. La connexion Postgres
// est un pool paresseux (server/src/db.ts) : une seule instance par
// fonction chaude, jamais fermée entre les appels — c'est le schéma
// recommandé pour Supabase (utilise l'URI du pooler, port 6543, dans
// DATABASE_URL ; voir README.md). Sur le plan gratuit Netlify, une
// invocation est limitée à 10 secondes : les actions NEXORA prennent
// normalement moins de 2 s.

import { handleRpcPayload } from "../../server/src/rpc";

// Types minimaux au format Netlify Functions v1 (HandlerEvent /
// HandlerResponse). Seuls les champs utilisés ici sont déclarés.
interface NetlifyEvent {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded: boolean;
}

interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

function jsonResponse(statusCode: number, body: unknown): NetlifyResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: "Method Not Allowed",
      };
    }
    const rawBody = event.body ?? "";
    const text = event.isBase64Encoded
      ? Buffer.from(rawBody, "base64").toString("utf8")
      : rawBody;
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return jsonResponse(400, { error: "Corps de requête JSON invalide." });
    }
    const result = await handleRpcPayload(payload);
    return jsonResponse(result.status, result.body);
  } catch (err) {
    console.error("Erreur dans /.netlify/functions/actions :", err);
    return jsonResponse(500, { error: "Erreur interne du serveur." });
  }
}
