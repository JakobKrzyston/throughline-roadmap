import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

import { LOCAL_DATA_DIR } from "./src/db/client";

// Read .env files the same way Next.js does, so DATABASE_URL means the same thing here as in the app.
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  ...(databaseUrl
    ? { dbCredentials: { url: databaseUrl } }
    : { driver: "pglite", dbCredentials: { url: LOCAL_DATA_DIR } }),
});
