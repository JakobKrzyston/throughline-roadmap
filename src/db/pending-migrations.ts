/** Compares the migration files with what a database has applied, without changing it. Exports pendingMigrations. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { bigint, pgSchema, text } from "drizzle-orm/pg-core";

import type { Database } from "./client";

// Where drizzle-kit migrate records each applied migration: drizzle-orm's default table, which
// drizzle.config.ts does not override. Each row's created_at is the journal entry's `when`.
const drizzleMigrations = pgSchema("drizzle").table("__drizzle_migrations", {
  createdAt: bigint("created_at", { mode: "number" }),
});

const tables = pgSchema("information_schema").table("tables", {
  schema: text("table_schema"),
  name: text("table_name"),
});

type Journal = { entries: { tag: string; when: number }[] };

/**
 * List the migrations in a folder that a database has not applied. Only reads the database.
 *
 * A migration counts as applied when the migrations table has a row with its journal timestamp.
 * This is per migration rather than drizzle's "anything newer than the last one", so a migration
 * merged out of order still shows up as missing.
 *
 * Args:
 *   db: The database to check.
 *   migrationsFolder: Folder holding the .sql files and meta/_journal.json.
 *
 * Returns:
 *   The tags (file names without .sql) of the unapplied migrations, oldest first. Empty when up to date.
 */
export async function pendingMigrations(
  db: Database,
  migrationsFolder: string,
): Promise<string[]> {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as Journal;

  // A database that was never migrated has no migrations table; querying it would throw.
  const found = await db
    .select({ name: tables.name })
    .from(tables)
    .where(
      and(
        eq(tables.schema, "drizzle"),
        eq(tables.name, "__drizzle_migrations"),
      ),
    );
  const applied = found.length
    ? await db
        .select({ createdAt: drizzleMigrations.createdAt })
        .from(drizzleMigrations)
    : [];
  const appliedAt = new Set(applied.map((row) => row.createdAt));

  return journal.entries
    .filter((entry) => !appliedAt.has(entry.when))
    .map((entry) => entry.tag);
}
