import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { createPgliteDb } from "./client";

const notes = pgTable("notes", {
  id: integer("id").primaryKey(),
  body: text("body").notNull(),
});

describe("createPgliteDb", () => {
  it("reads and writes an in-memory database", async () => {
    const db = createPgliteDb();
    await db.execute(
      sql`create table notes (id integer primary key, body text not null)`,
    );

    await db.insert(notes).values({ id: 1, body: "hello" });

    expect(await db.select().from(notes)).toEqual([{ id: 1, body: "hello" }]);
  });
});
