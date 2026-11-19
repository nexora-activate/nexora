// NEXORA — sonde de santé Netlify : GET /healthz.
//
// Répond toujours { ok: true } tant que la fonction démarre. Sert à
// vérifier que le déploiement répond, sans toucher à la base.

interface NetlifyEvent {
  httpMethod: string;
}

interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export async function handler(
  _event: NetlifyEvent,
): Promise<NetlifyResponse> {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ok: true }),
  };
}
