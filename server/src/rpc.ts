// NEXORA — handler RPC partagé (POST /actions).
//
// La même logique sert les deux points d'entrée du serveur :
//   - le serveur local de développement (server/src/index.ts),
//   - la fonction serverless Vercel (api/actions.ts).
// Corps JSON attendu : { action, args }. Réponse : { data } en cas de
// succès, { error, issues? } sinon — le format que le client
// (client/src/api.ts) consomme. Aucune API Bun ici : ce module tourne
// tel quel sous Node.js (runtime Vercel).

import { Actions } from "./actions";
import { createCtx } from "./ctx";
import type { Ctx } from "./framework";
import type { z } from "zod";

interface RpcActionDef {
  request: z.ZodType;
  response: z.ZodType;
  handler: (ctx: Ctx, args: never) => Promise<unknown>;
}

const actions = Actions as unknown as Record<string, RpcActionDef>;

export interface RpcResult {
  status: number;
  body: unknown;
}

export async function handleRpcPayload(payload: unknown): Promise<RpcResult> {
  const record = (payload ?? {}) as { action?: unknown; args?: unknown };
  const name = typeof record.action === "string" ? record.action : "";
  const def = actions[name];
  if (!def) {
    return { status: 404, body: { error: `Action inconnue : ${name || "(vide)"}` } };
  }
  const parsedArgs = def.request.safeParse(record.args ?? {});
  if (!parsedArgs.success) {
    return {
      status: 400,
      body: {
        error: "Paramètres invalides.",
        issues: parsedArgs.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      },
    };
  }
  try {
    const ctx = createCtx();
    const result = await def.handler(ctx, parsedArgs.data as never);
    const parsedResult = def.response.safeParse(result);
    if (!parsedResult.success) {
      console.error(
        `Réponse invalide de l'action ${name} :`,
        parsedResult.error.issues,
      );
      return { status: 500, body: { error: "Réponse du serveur invalide." } };
    }
    return { status: 200, body: { data: parsedResult.data } };
  } catch (err) {
    console.error(`Erreur dans l'action ${name} :`, err);
    return {
      status: 500,
      body: {
        error: err instanceof Error ? err.message : "Erreur interne du serveur.",
      },
    };
  }
}
