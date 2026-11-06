/** Tests for runBackfill importing a connected Linear team from the sample team, against the demo seed. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  FakeLinearAdapter,
  SAMPLE_LINEAR_TEAM,
  sampleLinearIssues,
} from "@/adapters/linear/fake-adapter";
import { jobs, repositories, requirements, workItems } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import { runBackfill } from "./backfill";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const now = new Date("2026-11-06T12:00:00.000Z");
let db: TestDb;
let repositoryId: string;

beforeEach(async () => {
  db = await createTestDb();
  const projectId = await seedDemoProject(db);
  [{ id: repositoryId }] = await db
    .insert(repositories)
    .values({
      projectId,
      source: "linear",
      externalId: SAMPLE_LINEAR_TEAM.id,
      fullName: SAMPLE_LINEAR_TEAM.key,
    })
    .returning();
});

describe("runBackfill for a Linear team", () => {
  it("imports the team's issues a page at a time, starting work but queueing no agents", async () => {
    const adapter = new FakeLinearAdapter(sampleLinearIssues(now), 2);
    const next = await runBackfill(db, adapter, { repositoryId }, now);
    expect(next).toMatchObject({ repositoryId, cursor: "2" });
    expect(await runBackfill(db, adapter, next!, now)).toBeUndefined();

    const rows = await db
      .select()
      .from(workItems)
      .where(eq(workItems.source, "linear"));
    expect(rows.map((row) => row.title).sort()).toEqual([
      "Chart tooltip cut off in Safari",
      "Expire public links after 30 days",
      "Share dialog: copy link button",
      "Timezone picker for scheduled reports",
    ]);
    // The started issue references TL-22, so its work has started.
    const [shareDialog] = await db
      .select({ status: requirements.status })
      .from(requirements)
      .where(eq(requirements.key, "TL-22"));
    expect(shareDialog.status).toBe("in_progress");
    // Work that finished before the team was connected is history: no reconcile or suggestion.
    expect(await db.$count(jobs)).toBe(0);
  });
});
