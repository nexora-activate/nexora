// NEXORA database access — Postgres (Supabase) through DATABASE_URL.
//
// The whole application reads and writes through this one Drizzle
// instance (drizzle-orm/node-postgres over a `pg` connection pool).
// There is no local database anymore: DATABASE_URL is the real database,
// in development exactly as in production (Render + Supabase).
//
// The pool is created lazily, on the first query, so that importing this
// module (typecheck, client build, tooling) never opens a connection and
// never fails when DATABASE_URL is not set yet — only an actual query
// does, with the driver's own error.

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let dbInstance: Db | null = null;

export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() ?? "";
}

export function getPool(): Pool {
  if (!pool) {
    const url = databaseUrl();
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set: NEXORA needs the Postgres (Supabase) connection string in its environment.",
      );
    }
    pool = new Pool({ connectionString: url, max: 5 });
  }
  return pool;
}

export function getDb(): Db {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

// Applies the SQL migrations in <space>/drizzle to the DATABASE_URL
// database. Idempotent (Drizzle records applied migrations in the
// database itself), so the standalone server runs it once at startup:
// a fresh Supabase project gets its tables with no manual step.
export async function runMigrations(migrationsFolder: string): Promise<void> {
  await migrate(getDb(), { migrationsFolder });
}

// Hosting check for the admin dashboard: reports whether DATABASE_URL is
// set, and — when it is — whether that database answers a real
// "SELECT 1". The probe goes through the application's own pool (which
// is built from DATABASE_URL), so it costs no extra connection — that
// matters on Supabase's free tier. The URL itself is NEVER returned,
// logged or included in any error: only the two booleans come back.
export async function probeDatabase(): Promise<{
  configured: boolean;
  reachable: boolean;
}> {
  if (!databaseUrl()) return { configured: false, reachable: false };
  try {
    await getPool().query("SELECT 1 AS ok");
    return { configured: true, reachable: true };
  } catch {
    return { configured: true, reachable: false };
  }
}
