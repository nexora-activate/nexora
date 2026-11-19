// Host services for NEXORA: password hashing, token and code
// generation, environment reads, the database probe, and the Discord
// OAuth2 exchange (the only place the Discord Client Secret is used: it
// is sent straight to discord.com from the server and never reaches the
// client or any action response).
//
// VERCEL — pas de SDK externe : les deux petits helpers ci-dessous
// (definePrivilegedContracts / definePrivilegedHandlers) remplacent
// ceux de @hatch/space-sdk, dont ce serveur autonome n'a plus besoin.
// Un contrat = un nom + un schéma de requête + un schéma de réponse ;
// un handler = une fonction qui reçoit les arguments validés. Le
// contexte (./ctx.ts) dispatche ctx.executePrivileged(contract, args)
// vers le handler du même nom.

import {
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { probeDatabase } from "./db";

export { z };

type PrivilegedContractSpec = {
  request: z.ZodType;
  response: z.ZodType;
  capabilities?: readonly string[];
  timeoutMs?: number;
};

// Le type d'un contrat garde les schémas Zod exacts déclarés : ainsi
// ctx.executePrivileged(contrat, args) renvoie le type inféré de la
// réponse (par ex. { hash: string }) au lieu de `unknown`.
export type PrivilegedContractFor<
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> = {
  __brand: "@nexora/privileged-contract/v1";
  name: string;
  request: Req;
  response: Res;
  capabilities?: readonly string[];
  timeoutMs?: number;
};

export type PrivilegedContract = PrivilegedContractFor<z.ZodType, z.ZodType>;

export function definePrivilegedContracts<const Specs extends Record<string, PrivilegedContractSpec>>(
  specs: Specs,
): { [K in keyof Specs]: PrivilegedContractFor<Specs[K]["request"], Specs[K]["response"]> } {
  const contracts = {} as Record<string, PrivilegedContract>;
  for (const [name, spec] of Object.entries(specs)) {
    contracts[name] = {
      __brand: "@nexora/privileged-contract/v1",
      name,
      request: spec.request,
      response: spec.response,
      ...(spec.capabilities !== undefined
        ? { capabilities: spec.capabilities }
        : {}),
      ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
    };
  }
  return contracts as { [K in keyof Specs]: PrivilegedContractFor<Specs[K]["request"], Specs[K]["response"]> };
}

export function definePrivilegedHandlers<
  Contracts extends Record<string, PrivilegedContract>,
>(
  contracts: Contracts,
  handlers: {
    [K in keyof Contracts]?: (
      args: z.infer<Contracts[K]["request"]>,
    ) =>
      | z.infer<Contracts[K]["response"]>
      | Promise<z.infer<Contracts[K]["response"]>>;
  },
): {
  format: "nexora-privileged-handlers-v1";
  entries: { contract: PrivilegedContract; handler: (args: never) => unknown }[];
} {
  const entries: { contract: PrivilegedContract; handler: (args: never) => unknown }[] = [];
  for (const [key, handler] of Object.entries(handlers)) {
    if (handler === undefined) continue;
    const contract = contracts[key];
    if (!contract || contract.__brand !== "@nexora/privileged-contract/v1") {
      throw new Error(`privileged handler '${key}' does not have a contract descriptor`);
    }
    entries.push({ contract, handler: handler as (args: never) => unknown });
  }
  return { format: "nexora-privileged-handlers-v1", entries };
}

export const privileged = definePrivilegedContracts({
  sha256: {
    request: z.object({ value: z.string() }),
    response: z.object({ hash: z.string() }),
    capabilities: ["crypto.hash"],
    timeoutMs: 10000,
  },
  hashNewPassword: {
    request: z.object({ password: z.string().min(1).max(200) }),
    response: z.object({ hash: z.string(), salt: z.string() }),
    capabilities: ["crypto.password"],
    timeoutMs: 10000,
  },
  verifyPassword: {
    request: z.object({
      password: z.string().max(200),
      salt: z.string(),
      expectedHash: z.string(),
    }),
    response: z.object({ ok: z.boolean() }),
    capabilities: ["crypto.password"],
    timeoutMs: 10000,
  },
  randomToken: {
    request: z.object({}),
    response: z.object({ token: z.string() }),
    capabilities: ["crypto.random"],
    timeoutMs: 10000,
  },
  randomCode: {
    request: z.object({}),
    response: z.object({ code: z.string() }),
    capabilities: ["crypto.random"],
    timeoutMs: 10000,
  },
  discordOAuthExchange: {
    request: z.object({
      code: z.string().min(1).max(500),
      clientId: z.string().min(1).max(40),
      clientSecret: z.string().min(1).max(200),
      redirectUri: z.string().min(1).max(500),
    }),
    response: z.object({
      ok: z.boolean(),
      // Internal diagnostic only (e.g. "token_http_400") — the action
      // layer translates it into a user-facing message.
      error: z.string(),
      discordId: z.string(),
      username: z.string(),
      globalName: z.string(),
      avatar: z.string(),
      email: z.string().nullable(),
      verified: z.boolean(),
    }),
    capabilities: ["network.fetch"],
    timeoutMs: 20000,
  },
  readEnv: {
    // Reads ONE named environment variable on the host (used for
    // DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI and NEXORA_API_KEY,
    // which take precedence over the admin-saved config). The value is
    // returned to the calling action only — never to a client — and the
    // handler refuses any other variable name.
    request: z.object({ name: z.string().min(1).max(60) }),
    response: z.object({ value: z.string() }),
    capabilities: ["env.read"],
    timeoutMs: 5000,
  },
  probeDatabase: {
    // Hosting check: reports whether DATABASE_URL (the Supabase
    // Postgres connection string) is set in the server environment,
    // and — when it is — whether that database answers a real
    // "SELECT 1". The URL itself is NEVER returned, logged or included
    // in any error: only the two booleans come back.
    request: z.object({}),
    response: z.object({ configured: z.boolean(), reachable: z.boolean() }),
    capabilities: ["network.fetch"],
    timeoutMs: 20000,
  },
});

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
  sha256(args) {
    return { hash: createHash("sha256").update(args.value).digest("hex") };
  },
  hashNewPassword(args) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(args.password, salt, 32).toString("hex");
    return { hash, salt };
  },
  verifyPassword(args) {
    const actual = scryptSync(args.password, args.salt, 32);
    const expected = Buffer.from(args.expectedHash, "hex");
    const ok =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    return { ok };
  },
  randomToken() {
    return { token: randomBytes(24).toString("hex") };
  },
  randomCode() {
    return { code: String(randomInt(0, 1000000)).padStart(6, "0") };
  },
  async discordOAuthExchange(args) {
    const fail = (error: string) => ({
      ok: false,
      error,
      discordId: "",
      username: "",
      globalName: "",
      avatar: "",
      email: null,
      verified: false,
    });
    try {
      // 1) Échange du code d'autorisation contre un jeton d'accès,
      //    exactement comme le demande l'OAuth2 de Discord.
      const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: args.clientId,
          client_secret: args.clientSecret,
          grant_type: "authorization_code",
          code: args.code,
          redirect_uri: args.redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) return fail(`token_http_${tokenRes.status}`);
      const tokenJson = (await tokenRes.json()) as { access_token?: unknown };
      const accessToken =
        typeof tokenJson.access_token === "string" ? tokenJson.access_token : "";
      if (!accessToken) return fail("token_missing");
      // 2) Lecture du compte Discord autorisé (pseudo + avatar, scope
      //    "identify" demandé à l'autorisation).
      const userRes = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!userRes.ok) return fail(`user_http_${userRes.status}`);
      const u = (await userRes.json()) as {
        id?: unknown;
        username?: unknown;
        global_name?: unknown;
        avatar?: unknown;
        email?: unknown;
        verified?: unknown;
      };
      if (typeof u.id !== "string" || typeof u.username !== "string") {
        return fail("user_shape");
      }
      return {
        ok: true,
        error: "",
        discordId: u.id,
        username: u.username,
        globalName: typeof u.global_name === "string" ? u.global_name : "",
        avatar: typeof u.avatar === "string" ? u.avatar : "",
        email: typeof u.email === "string" ? u.email : null,
        verified: u.verified === true,
      };
    } catch {
      return fail("network_error");
    }
  },
  readEnv(args) {
    // Liste blanche stricte : seules les variables de configuration
    // NEXORA peuvent être lues, jamais autre chose de l'environnement.
    const ALLOWED = new Set([
      "DISCORD_CLIENT_SECRET",
      "DISCORD_REDIRECT_URI",
      "NEXORA_API_KEY",
    ]);
    if (!ALLOWED.has(args.name)) return { value: "" };
    return { value: process.env[args.name]?.trim() ?? "" };
  },
  async probeDatabase() {
    return probeDatabase();
  },
});
