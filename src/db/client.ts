/** Database clients: Postgres when DATABASE_URL is set, embedded PGlite otherwise. Exports getDb, createPgliteDb, createPostgresDb. */
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/** The query interface shared by the PGlite and Postgres clients. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Directory where local PGlite keeps its data between runs. */
export const LOCAL_DATA_DIR = ".pglite";

/**
 * Create a Drizzle client backed by embedded PGlite.
 *
 * Args:
 *   dataDir: Directory to persist data in. Omit for an in-memory database, as tests do.
 *
 * Returns:
 *   A Drizzle client for the PGlite database.
 */
export function createPgliteDb(dataDir?: string) {
  return drizzlePglite(new PGlite(dataDir), { schema });
}

/**
 * Create a Drizzle client for a Postgres server such as Neon.
 *
 * Args:
 *   url: Postgres connection string.
 *
 * Returns:
 *   A Drizzle client for the Postgres database.
 */
export function createPostgresDb(url: string) {
  return drizzlePostgres(postgres(url), { schema });
}

const globalForDb = globalThis as { db?: Database };

/**
 * Return the app's shared database client, creating it on first use.
 *
 * Returns:
 *   A Postgres client when DATABASE_URL is set, otherwise a PGlite client stored in LOCAL_DATA_DIR.
 */
export function getDb(): Database {
  // Cached on globalThis so dev hot reloads reuse one client; two PGlite instances must not open the same directory.
  globalForDb.db ??= process.env.DATABASE_URL
    ? createPostgresDb(process.env.DATABASE_URL)
    : createPgliteDb(LOCAL_DATA_DIR);
  return globalForDb.db;
}
