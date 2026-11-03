import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPgliteDb } from "./client";

describe("createPgliteDb", () => {
  it("runs queries against an in-memory database", async () => {
    const db = createPgliteDb();

    const result = await db.execute<{ sum: number }>(sql`select 1 + 1 as sum`);

    expect(result.rows).toEqual([{ sum: 2 }]);
  });
});
