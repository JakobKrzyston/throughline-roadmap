/** Database clients: Postgres when DATABASE_URL is set, embedded PGlite otherwise. Exports getDb, createPgliteDb, createPostgresDb. */
import { PGlite } from "@electric-sql/pglite";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * The query interface shared by the PGlite and Postgres clients.
 *
 * Prefer the query builder: raw `execute()` results can differ in shape between PGlite and node-postgres.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Directory where local PGlite keeps its data between runs. The end-to-end tests use their own.
 *
 * Read on each call, not at import, so scripts that load .env files in main() still see PGLITE_DATA_DIR.
 *
 * Returns:
 *   PGLITE_DATA_DIR if set, otherwise ".pglite".
 */
export function localDataDir(): string {
  return process.env.PGLITE_DATA_DIR || ".pglite";
}

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
 *   url: Postgres connection string. Use Neon's pooled (-pooler) string for app traffic.
 *
 * Returns:
 *   A Drizzle client backed by a node-postgres pool.
 */
export function createPostgresDb(url: string) {
  const pool = new Pool({ connectionString: url });
  // On Vercel Fluid compute, closes idle connections before an instance suspends so they don't leak. A no-op elsewhere.
  attachDatabasePool(pool);
  return drizzleNodePg(pool, { schema });
}

const globalForDb = globalThis as { db?: Database };

/**
 * Return the app's shared database client, creating it on first use.
 *
 * Returns:
 *   A Postgres client when DATABASE_URL is set, otherwise a PGlite client stored in localDataDir().
 */
export function getDb(): Database {
  // Cached on globalThis so dev hot reloads reuse one client; two PGlite instances must not open the same directory.
  globalForDb.db ??= process.env.DATABASE_URL
    ? createPostgresDb(process.env.DATABASE_URL)
    : createPgliteDb(localDataDir());
  return globalForDb.db;
}
