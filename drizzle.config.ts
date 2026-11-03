import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Read .env files the same way Next.js does, so DATABASE_URL means the same thing here as in the app.
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
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
