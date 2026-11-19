// Le contexte réel du serveur autonome, passé aux handlers des actions :
// base Postgres partagée (./db.ts), services hôte en processus
// (./privileged.ts, dispatchés par nom de contrat), e-mail SMTP direct
// (./mailer.ts). Seul le serveur (./index.ts) l'utilise — le code des
// actions ne dépend que des types de ./framework.ts.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { z } from "zod";
import { getDb } from "./db";
import type { Ctx, HostContract } from "./framework";
import { sendMail } from "./mailer";
import { privilegedHandlers } from "./privileged";
import type * as schema from "./schema";

export function createCtx(): Ctx {
  const entries = (
    privilegedHandlers as unknown as {
      entries: {
        contract: { name: string };
        handler: (args: never) => unknown;
      }[];
    }
  ).entries;
  const byName = new Map(entries.map((e) => [e.contract.name, e.handler]));
  return {
    db<TSchema extends Record<string, unknown> = typeof schema>(): NodePgDatabase<TSchema> {
      return getDb() as unknown as NodePgDatabase<TSchema>;
    },
    async executePrivileged<C extends HostContract>(
      contract: C,
      args: z.infer<C["request"]>,
    ): Promise<z.infer<C["response"]>> {
      const handler = byName.get(contract.name);
      if (!handler) {
        throw new Error(`Service hôte inconnu : ${contract.name}`);
      }
      const parsedArgs = contract.request.parse(args);
      const result = await handler(parsedArgs as never);
      return contract.response.parse(result) as z.infer<C["response"]>;
    },
    mailer: { send: sendMail },
    invalidateQueries() {
      // No-op dans le serveur autonome : le client relit ses données
      // après chaque mutation.
    },
  };
}
