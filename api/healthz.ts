// NEXORA — sonde de santé Vercel : GET /healthz.
//
// Répond toujours { ok: true } tant que la fonction démarre. Sert à
// vérifier que le déploiement répond, sans toucher à la base.

import type { IncomingMessage, ServerResponse } from "node:http";

export default function handler(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const text = JSON.stringify({ ok: true });
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}
