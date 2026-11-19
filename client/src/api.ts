// Typed RPC client for the standalone NEXORA server.
//
// Every call is a plain `fetch` POST to `./actions` with a JSON body
// `{ action, args }`; the server (server/src/index.ts) answers
// `{ data: <result> }` on success and `{ error, issues? }` with a non-200
// status on failure. Types come straight from `server/src/actions.ts` —
// no codegen. `import type { Actions }` is type-only by design: the
// client bundle never pulls in any server runtime.

import type { Actions } from "../../server/src/actions";
import type { z } from "zod";

export interface ActionIssue {
  path: string[];
  message: string;
}

/**
 * Error thrown by an action call when the server returns a non-OK HTTP
 * response. Carries the HTTP `status` and the request-schema `issues`
 * (when the rejection came from argument validation) so the page can
 * word the failure precisely.
 */
export class ActionError extends Error {
  status: number;
  issues: ActionIssue[];
  detail: string;

  constructor(message: string, status: number, issues: ActionIssue[] = []) {
    super(message);
    this.name = "ActionError";
    this.status = status;
    this.issues = issues;
    this.detail = message;
  }
}

type ActionsShape = typeof Actions;

type ClientFor<T> = {
  [K in keyof T]: T[K] extends { request: infer Req; response: infer Res }
    ? Req extends z.ZodType
      ? Res extends z.ZodType
        ? (args: z.infer<Req>) => Promise<z.infer<Res>>
        : never
      : never
    : never;
};

export type ApiRequest<
  C,
  K extends keyof C,
> = C[K] extends (args: infer A) => Promise<unknown> ? A : never;

export type ApiResponse<
  C,
  K extends keyof C,
> = C[K] extends (args: never) => Promise<infer R> ? R : never;

async function callAction(action: string, args: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch("./actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, args: args ?? {} }),
    });
  } catch (err) {
    throw new ActionError(
      err instanceof Error ? err.message : "Network error.",
      0,
    );
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const record = (body ?? {}) as {
      error?: unknown;
      issues?: { path?: unknown; message?: unknown }[];
    };
    const issues: ActionIssue[] = Array.isArray(record.issues)
      ? record.issues.map((i) => ({
          path: Array.isArray(i.path) ? i.path.map(String) : [],
          message: typeof i.message === "string" ? i.message : "Invalid value.",
        }))
      : [];
    if (issues.length > 0) {
      const message = [...new Set(issues.map((i) => i.message))].join("\n");
      throw new ActionError(message, response.status, issues);
    }
    throw new ActionError(
      typeof record.error === "string" && record.error
        ? record.error
        : `Request failed (${response.status}).`,
      response.status,
    );
  }
  const record = (body ?? {}) as { data?: unknown; error?: unknown };
  if (record.error) {
    throw new ActionError(String(record.error), response.status);
  }
  return record.data;
}

function createActionClient<T>(): ClientFor<T> {
  return new Proxy(
    {},
    {
      get(_target, name) {
        // Symbol keys and promise-protocol names must not resolve to a
        // phantom action (an accidental `await client` would otherwise
        // POST an action named "then").
        if (typeof name !== "string") return undefined;
        if (name === "then" || name === "catch" || name === "finally") {
          return undefined;
        }
        return (args: unknown) => callAction(name, args);
      },
    },
  ) as ClientFor<T>;
}

export const api = createActionClient<ActionsShape>();
