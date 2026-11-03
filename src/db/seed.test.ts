/** Tests that the Acme Analytics demo seed builds a valid, varied graph. */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { applyProposal } from "@/core/proposals";
import { productStatus, type RequirementNode } from "@/core/rollup";

import {
  events,
  links,
  outcomes,
  projects,
  proposals,
  requirements,
  workItems,
} from "./schema";
import { DEMO_SLUG, seedDemoProject } from "./seed";
import { createTestDb } from "./test-db";

type Requirement = typeof requirements.$inferSelect;

function toNode(row: Requirement, all: Requirement[]): RequirementNode {
  return {
    status: row.status,
    userVisible: row.userVisible,
    children: all
      .filter((child) => child.parentId === row.id)
      .map((child) => toNode(child, all)),
  };
}

describe("seedDemoProject", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    db = await createTestDb();
    await seedDemoProject(db);
  });

  it("creates the demo graph on a fresh database", async () => {
    const reqs = await db.select().from(requirements);
    const splitParents = reqs.filter((r) => r.splitReason !== null);

    expect(await db.$count(outcomes)).toBe(5);
    expect(reqs).toHaveLength(22);
    expect(splitParents.map((r) => r.key).sort()).toEqual([
      "TL-1",
      "TL-15",
      "TL-16",
      "TL-8",
    ]);
    expect(await db.$count(workItems)).toBe(25);
    expect(await db.$count(links)).toBe(24);
    expect(await db.$count(events)).toBeGreaterThan(0);
  });

  it("gives the outcomes a spread of product statuses", async () => {
    const reqs = await db.select().from(requirements);
    const rows = await db.select().from(outcomes).orderBy(outcomes.key);

    const statuses = rows.map((outcome) =>
      productStatus(
        reqs
          .filter((r) => r.outcomeId === outcome.id)
          .map((r) => toNode(r, reqs)),
      ),
    );

    expect(statuses).toEqual([
      "partially_available",
      "in_progress",
      "delivered",
      "in_progress",
      "not_started",
    ]);
  });

  it("leaves pending proposals that apply cleanly", async () => {
    const pending = await db
      .select()
      .from(proposals)
      .where(eq(proposals.status, "pending"));
    expect(pending).toHaveLength(3);

    for (const proposal of pending) {
      await applyProposal(db, proposal.id, "pm");
    }
  });

  it("never replaces a project that is not a demo", async () => {
    const fresh = await createTestDb();
    await fresh.insert(projects).values({ name: "Real", slug: DEMO_SLUG });

    await expect(seedDemoProject(fresh)).rejects.toThrow();
    expect(await fresh.select().from(projects)).toMatchObject([
      { name: "Real", isDemo: false },
    ]);
  });

  it("replaces the demo project when run again", async () => {
    await seedDemoProject(db);

    expect(await db.$count(outcomes)).toBe(5);
    expect(await db.$count(workItems)).toBe(25);
  });
});
