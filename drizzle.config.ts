// Configuration Drizzle Kit (Postgres / Supabase).
// Utilisée par `npx drizzle-kit migrate` pour appliquer les migrations
// de ./drizzle à la base désignée par DATABASE_URL. En production sur
// Vercel, les migrations NE tournent PAS au démarrage (serverless) :
// on les applique une fois en local, avec l'URI DIRECTE Supabase
// (db.<ref>.supabase.co:5432), avant de déployer — voir README.md.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
