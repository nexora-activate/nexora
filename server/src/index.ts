// NEXORA — serveur autonome (point d'entrée).
//
// Un seul processus sert tout :
//   - le client construit (client/dist) en fichiers statiques,
//   - la RPC des actions : POST /actions, corps JSON { action, args },
//     réponse JSON { data } en cas de succès, { error } sinon — le même
//     format que le client (client/src/api.ts) consomme.
//   - GET /healthz pour les vérifications de l'hébergeur.
//
// Démarrage : `bun run start` (ou `npm start`). Le port vient de
// process.env.PORT (défaut 3000). La base est le Postgres de
// DATABASE_URL (Supabase) ; les migrations SQL de ./drizzle sont
// appliquées au démarrage quand la base est joignable (idempotent).
// Aucune dépendance à un service externe d'orchestration : ce fichier +
// le reste de server/src + client/dist suffisent, par exemple sur
// Render (plan gratuit) avec les variables d'environnement documentées
// dans .env.example.

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { Actions } from "./actions";
import { createCtx } from "./ctx";
import { runMigrations } from "./db";
import type { Ctx } from "./framework";
import type { z } from "zod";

const PORT = Number(process.env.PORT ?? "3000") || 3000;
const ROOT = join(import.meta.dir, "..", "..");
const CLIENT_DIST = join(ROOT, "client", "dist");
const MIGRATIONS_DIR = join(ROOT, "drizzle");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

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

// ---------------------------------------------------------------------------
// RPC POST /actions
// ---------------------------------------------------------------------------

interface RpcActionDef {
  request: z.ZodType;
  response: z.ZodType;
  handler: (ctx: Ctx, args: never) => Promise<unknown>;
}

const actions = Actions as unknown as Record<string, RpcActionDef>;
const ctx = createCtx();

async function handleActions(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: { action?: unknown; args?: unknown };
  try {
    payload = JSON.parse(await readBody(req)) as typeof payload;
  } catch {
    sendJson(res, 400, { error: "Corps de requête JSON invalide." });
    return;
  }
  const name = typeof payload.action === "string" ? payload.action : "";
  const def = actions[name];
  if (!def) {
    sendJson(res, 404, { error: `Action inconnue : ${name || "(vide)"}` });
    return;
  }
  const parsedArgs = def.request.safeParse(payload.args ?? {});
  if (!parsedArgs.success) {
    sendJson(res, 400, {
      error: "Paramètres invalides.",
      issues: parsedArgs.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    });
    return;
  }
  try {
    const result = await def.handler(ctx, parsedArgs.data as never);
    const parsedResult = def.response.safeParse(result);
    if (!parsedResult.success) {
      console.error(
        `Réponse invalide de l'action ${name} :`,
        parsedResult.error.issues,
      );
      sendJson(res, 500, { error: "Réponse du serveur invalide." });
      return;
    }
    sendJson(res, 200, { data: parsedResult.data });
  } catch (err) {
    console.error(`Erreur dans l'action ${name} :`, err);
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Erreur interne du serveur.",
    });
  }
}

// ---------------------------------------------------------------------------
// Fichiers statiques (client/dist) + repli SPA sur index.html
// ---------------------------------------------------------------------------

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(CLIENT_DIST, rel);
  if (
    filePath.startsWith(CLIENT_DIST) &&
    existsSync(filePath) &&
    statSync(filePath).isFile()
  ) {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "cache-control": rel.includes("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    res.end(data);
    return;
  }
  // Repli SPA : toute autre adresse sert l'application (le retour OAuth
  // Discord, par exemple, arrive sur l'adresse du site avec ?code&state).
  const indexPath = join(CLIENT_DIST, "index.html");
  if (existsSync(indexPath)) {
    const data = await readFile(indexPath);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.end(data);
    return;
  }
  res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
  res.end("NEXORA: le client n'est pas construit. Lancez `bun run build`.");
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "POST" && url.pathname === "/actions") {
        await handleActions(req, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        await serveStatic(url.pathname, res);
        return;
      }
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
    } catch (err) {
      console.error("Erreur HTTP :", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      }
      res.end("Internal Server Error");
    }
  })();
});

server.listen(PORT, () => {
  console.log(`NEXORA écoute sur le port ${PORT}`);
});

// Migrations au démarrage : une base Supabase neuve reçoit ses tables
// sans étape manuelle. En cas d'échec (base pas encore créée, URL
// absente), le serveur reste debout : la page s'affiche et l'erreur est
// visible dans les journaux, pas silencieuse.
void (async () => {
  try {
    await runMigrations(MIGRATIONS_DIR);
    console.log("Migrations de la base appliquées (DATABASE_URL).");
  } catch (err) {
    console.error(
      "Migrations non appliquées (le serveur continue, les actions base de données échoueront tant que DATABASE_URL n'est pas joignable) :",
      err instanceof Error ? err.message : err,
    );
  }
})();
