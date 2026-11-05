/** Tests that pendingMigrations reports exactly the migrations a database has not applied. */
import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPgliteDb } from "./client";
import { pendingMigrations } from "./pending-migrations";
import { createTestDb } from "./test-db";

const FOLDER = "src/db/migrations";
const journal = JSON.parse(
  readFileSync(`${FOLDER}/meta/_journal.json`, "utf8"),
) as { entries: { tag: string; when: number }[] };

function whenOf(tag: string): number {
  return journal.entries.find((entry) => entry.tag === tag)!.when;
}

describe("pendingMigrations", () => {
  it("is empty for a fully migrated database", async () => {
    const db = await createTestDb();

    expect(await pendingMigrations(db, FOLDER)).toEqual([]);
  });

  it("names the latest migration when the database is one behind", async () => {
    const db = await createTestDb();
    await db.execute(
      sql`delete from drizzle.__drizzle_migrations where created_at = ${whenOf("0010_feedback")}`,
    );

    expect(await pendingMigrations(db, FOLDER)).toEqual(["0010_feedback"]);
  });

  it("names a migration that is missing between applied ones", async () => {
    const db = await createTestDb();
    await db.execute(
      sql`delete from drizzle.__drizzle_migrations where created_at = ${whenOf("0008_planning")}`,
    );

    expect(await pendingMigrations(db, FOLDER)).toEqual(["0008_planning"]);
  });

  it("lists every migration for a database that was never migrated, and leaves it unchanged", async () => {
    const db = createPgliteDb();

    expect(await pendingMigrations(db, FOLDER)).toEqual(
      journal.entries.map((entry) => entry.tag),
    );
    const { rows } = await db.execute<{ name: string | null }>(
      sql`select to_regclass('drizzle.__drizzle_migrations')::text as name`,
    );
    expect(rows[0].name).toBeNull();
  });
});
