// Cadre minimal des actions NEXORA (serveur autonome, sans SDK externe).
//
// Une action = une description, un schéma Zod de requête, un schéma Zod
// de réponse et un handler `(ctx, args)`. Le serveur HTTP
// (server/src/index.ts) reçoit les appels RPC `POST /actions`
// ({ action, args }), valide les arguments avec le schéma de requête,
// appelle le handler avec le contexte ci-dessous, valide la réponse avec
// le schéma de réponse, et renvoie le résultat en JSON ({ data }).
//
// Le contexte donne au handler :
//   - db()               la base Postgres (Drizzle, voir ./db.ts)
//   - executePrivileged  les services hôte de ./privileged.ts (crypto,
//                        échange OAuth Discord, lecture d'environnement,
//                        sonde de base), appelés en processus dans le
//                        serveur autonome — les contrats sont déclarés
//                        dans ./privileged.ts, le contexte réel dans
//                        ./ctx.ts
//   - mailer             l'envoi d'e-mails SMTP (voir ./mailer.ts)
//   - invalidateQueries  conservé pour compatibilité des handlers : dans
//                        le serveur autonome, le client relit ses données
//                        après chaque mutation, donc c'est un no-op.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type { MailInput, MailResult } from "./mailer";
import type * as schema from "./schema";

export { z };

export type Db = NodePgDatabase<typeof schema>;

// Contrat d'un service hôte : un nom + les schémas de sa requête et de
// sa réponse (la forme des descripteurs de ./privileged.ts).
// `executePrivileged` est typé à travers ces contrats, donc un appel
// reçoit exactement la forme de réponse déclarée.
export interface HostContract {
  readonly name: string;
  readonly request: z.ZodType;
  readonly response: z.ZodType;
}

export interface Ctx {
  db<TSchema extends Record<string, unknown> = typeof schema>(): NodePgDatabase<TSchema>;
  executePrivileged<C extends HostContract>(
    contract: C,
    args: z.infer<C["request"]>,
  ): Promise<z.infer<C["response"]>>;
  readonly mailer: {
    send(input: MailInput): Promise<MailResult>;
  };
  invalidateQueries(): void;
}

export interface ActionDefinition<ReqS extends z.ZodType, ResS extends z.ZodType> {
  readonly description: string;
  readonly request: ReqS;
  readonly response: ResS;
  readonly privileged?: readonly unknown[];
  readonly handler: (ctx: Ctx, args: z.infer<ReqS>) => Promise<z.infer<ResS>>;
}

export function defineAction<ReqS extends z.ZodType, ResS extends z.ZodType>(spec: {
  description: string;
  request: ReqS;
  response: ResS;
  privileged?: readonly unknown[];
  handler: (ctx: Ctx, args: z.infer<ReqS>) => Promise<z.infer<ResS>>;
}): ActionDefinition<ReqS, ResS> {
  return spec;
}

// La forme large que le module d'actions doit satisfaire : elle écrase
// les génériques (invariants via `request` et `handler`) en gardant un
// handler appelable, pour signaler toute valeur étrangère dans l'objet
// Actions sans élargir les types précis utilisés côté client.
export interface AnyActionDefinition {
  readonly description: string;
  readonly request: z.ZodType;
  readonly response: z.ZodType;
  readonly privileged?: readonly unknown[];
  readonly handler: (ctx: Ctx, args: never) => Promise<unknown>;
}

export type ActionsModule = Record<string, AnyActionDefinition>;
