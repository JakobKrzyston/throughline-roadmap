import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Read .env files the same way Next.js does, so DATABASE_URL means the same thing here as in the app.
loadEnvConfig(process.cwd());

// Migrations need a direct connection: Neon's pooler runs in transaction mode, which breaks session state.
// An empty or unset DATABASE_URL means PGlite, as it does for the app, even if .env.local sets the unpooled URL.
const databaseUrl = process.env.DATABASE_URL
  ? process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  : undefined;
// Same directory as localDataDir() in src/db/client.ts.
const localDataDir = process.env.PGLITE_DATA_DIR || ".pglite";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  ...(databaseUrl
    ? { dbCredentials: { url: databaseUrl } }
    : { driver: "pglite", dbCredentials: { url: localDataDir } }),
});
