// NEXORA — fonction serverless Vercel : POST /actions.
//
// Vercel réécrit /actions vers cette fonction (voir vercel.json). Elle
// partage le handler RPC avec le serveur local (server/src/rpc.ts) :
// mêmes actions, mêmes validations, même format de réponse
// ({ data } / { error }). Runtime Node.js (aucune API Bun).
//
// Fonctionnement serverless : la fonction démarre à froid à la première
// requête, se réutilise tant qu'elle reste chaude. La connexion Postgres
// est un pool paresseux (server/src/db.ts) : une seule instance par
// fonction chaude, jamais fermée entre les appels — c'est le schéma
// recommandé pour Supabase (utilise l'URI du pooler, port 6543, dans
// DATABASE_URL ; voir README.md).

import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRpcPayload } from "../server/src/rpc";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "Corps de requête JSON invalide." });
      return;
    }
    const result = await handleRpcPayload(payload);
    sendJson(res, result.status, result.body);
  } catch (err) {
    console.error("Erreur dans /api/actions :", err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Erreur interne du serveur." });
    } else {
      res.end();
    }
  }
}
