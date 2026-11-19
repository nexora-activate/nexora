// Configuration Drizzle Kit (Postgres / Supabase).
// Utilisée par `bunx drizzle-kit migrate` pour appliquer les migrations
// de ./drizzle à la base désignée par DATABASE_URL. Le serveur autonome
// applique aussi ces migrations tout seul à son démarrage ; ce fichier
// sert pour les opérations manuelles (inspection, régénération).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
