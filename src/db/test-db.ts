/** Test helper: a fresh in-memory PGlite database with every migration applied. Exports createTestDb. */
import { migrate } from "drizzle-orm/pglite/migrator";

import { createPgliteDb } from "./client";

/**
 * Create an empty, fully migrated in-memory database.
 *
 * Returns:
 *   A Drizzle client for the new database.
 */
export async function createTestDb() {
  const db = createPgliteDb();
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}
