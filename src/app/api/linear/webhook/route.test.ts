/** Tests for POST /api/linear/webhook with signed requests, a fake Linear and an in-memory database. */
import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinearIssue } from "@/adapters/linear/adapter";
import { FakeLinearAdapter } from "@/adapters/linear/fake-adapter";
import { applyProposal } from "@/core/proposals";
import {
  jobs,
  links,
  projects,
  proposals,
  repositories,
  requirements,
  workItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  issues: [] as unknown[],
  configured: true,
}));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));
// Linear is never called: the route reads issues from a fake serving `state.issues`.
vi.mock(import("@/adapters/linear"), async (importOriginal) => ({
  ...(await importOriginal()),
  linearAdapterFor: () =>
    state.configured
      ? new FakeLinearAdapter(state.issues as LinearIssue[])
      : null,
}));
// after() needs a Next.js request scope; the job run it schedules is not under test here.
vi.mock("next/server", () => ({ after: vi.fn() }));

const { after } = await import("next/server");
const { POST } = await import("./route");

const SECRET = "linear-webhook-secret";
const TEAM = { id: "team-1", key: "ENG" };
let db: TestDb;

function issue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-12",
    title: "CSV export button",
    description: "Implements TL-3",
    url: "https://linear.app/acme/issue/ENG-12/csv-export-button",
    state: { type: "started" },
    team: TEAM,
    project: { id: "project-1" },
    assignee: { displayName: "maya", app: false },
    completedAt: null,
    canceledAt: null,
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  vi.mocked(after).mockClear();
  vi.stubEnv("LINEAR_WEBHOOK_SECRET", SECRET);
  state.configured = true;
  state.issues = [issue()];
  db = await createTestDb();
  state.db = db;
  const [project] = await db
    .insert(projects)
    .values({ name: "Test", slug: "test" })
    .returning();
  await db.insert(repositories).values({
    projectId: project.id,
    source: "linear",
    externalId: TEAM.id,
    fullName: TEAM.key,
  });
  const [proposal] = await db
    .insert(proposals)
    .values({
      projectId: project.id,
      source: "import",
      summary: "Roadmap",
      operations: [
        { type: "create_outcome", key: "OUT-1", title: "Export" },
        {
          type: "create_requirement",
          key: "TL-3",
          outcome_key: "OUT-1",
          title: "CSV",
        },
      ],
    })
    .returning();
  await applyProposal(db, proposal.id, "pm");
});

function delivery(
  payload: unknown,
  options: { secret?: string; signature?: string | null } = {},
): Request {
  const body = JSON.stringify(payload);
  const signature =
    options.signature === undefined
      ? createHmac("sha256", options.secret ?? SECRET)
          .update(body)
          .digest("hex")
      : options.signature;
  return new Request("http://localhost/api/linear/webhook", {
    method: "POST",
    headers: signature === null ? {} : { "linear-signature": signature },
    body,
  });
}

const issueUpdate = (teamId = TEAM.id) => ({
  type: "Issue",
  action: "update",
  data: { id: "issue-1", teamId, title: "CSV export button" },
  webhookTimestamp: Date.now(),
});

async function tl3Status(): Promise<string | null> {
  const [row] = await db
    .select({ status: requirements.status })
    .from(requirements)
    .where(eq(requirements.key, "TL-3"));
  return row.status;
}

describe("POST /api/linear/webhook", () => {
  it("rejects a bad or missing signature with 401 and stores nothing", async () => {
    const wrong = await POST(delivery(issueUpdate(), { secret: "wrong" }));
    const missing = await POST(delivery(issueUpdate(), { signature: null }));
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await db.$count(workItems)).toBe(0);
    expect(after).not.toHaveBeenCalled();
  });

  it("returns 503 when no webhook secret is set", async () => {
    vi.stubEnv("LINEAR_WEBHOOK_SECRET", "");
    expect((await POST(delivery(issueUpdate()))).status).toBe(503);
  });

  it("syncs the issue as Linear reports it, and an In Progress issue starts its requirement", async () => {
    const response = await POST(delivery(issueUpdate()));
    expect(await response.json()).toEqual({ status: "synced", projects: 1 });
    const [row] = await db.select().from(workItems);
    expect(row).toMatchObject({
      source: "linear",
      externalId: "issue-1",
      state: "open",
      people: ["maya"],
    });
    expect(await tl3Status()).toBe("in_progress");
  });

  it("creates no duplicates when the same delivery is replayed", async () => {
    const payload = issueUpdate();
    await POST(delivery(payload));
    state.issues = [
      issue({
        state: { type: "completed" },
        completedAt: "2026-11-02T09:00:00.000Z",
        updatedAt: "2026-11-02T09:00:00.000Z",
      }),
    ];
    await POST(delivery(payload));
    await POST(delivery(payload));

    expect(await db.$count(workItems)).toBe(1);
    expect(await db.$count(links)).toBe(1);
    expect(
      await db.$count(proposals, eq(proposals.source, "work_started")),
    ).toBe(1);
    expect(await db.$count(jobs, eq(jobs.type, "reconcile"))).toBe(1);
  });

  it("ignores issues of teams that are not connected, without reading Linear", async () => {
    state.configured = false;
    const response = await POST(delivery(issueUpdate("team-other")));
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(await db.$count(workItems)).toBe(0);
  });

  it("ignores other kinds of delivery and removed issues", async () => {
    const comment = await POST(
      delivery({
        type: "Comment",
        action: "create",
        data: { id: "c-1" },
        webhookTimestamp: Date.now(),
      }),
    );
    const removed = await POST(
      delivery({ ...issueUpdate(), action: "remove" }),
    );
    expect(await comment.json()).toEqual({ status: "ignored" });
    expect(await removed.json()).toEqual({ status: "ignored" });
    expect(await db.$count(workItems)).toBe(0);
  });

  it("rejects an unreadable payload with 400", async () => {
    const response = await POST(
      delivery({
        type: "Issue",
        action: "update",
        data: {},
        webhookTimestamp: Date.now(),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a correctly signed delivery sent more than a minute ago with 401", async () => {
    const old = await POST(
      delivery({ ...issueUpdate(), webhookTimestamp: Date.now() - 120_000 }),
    );
    const missing = await POST(
      delivery({ ...issueUpdate(), webhookTimestamp: undefined }),
    );
    expect(old.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await db.$count(workItems)).toBe(0);
    expect(after).not.toHaveBeenCalled();
  });

  it("keeps updating an issue moved to a team that is not connected", async () => {
    await POST(delivery(issueUpdate()));
    expect(await tl3Status()).toBe("in_progress");
    // Moved to the OPS team, which no project connects, then completed there.
    state.issues = [
      issue({
        identifier: "OPS-7",
        team: { id: "team-ops", key: "OPS" },
        state: { type: "completed" },
        completedAt: "2026-11-02T09:00:00.000Z",
        updatedAt: "2026-11-02T09:00:00.000Z",
      }),
    ];
    const response = await POST(delivery(issueUpdate("team-ops")));
    expect(await response.json()).toEqual({ status: "synced", projects: 1 });
    const [row] = await db.select().from(workItems);
    expect(row).toMatchObject({ state: "closed", identifier: "OPS-7" });
    expect(await db.$count(jobs, eq(jobs.type, "reconcile"))).toBe(1);
  });

  it("syncs a moved issue once into a project that connects both teams", async () => {
    const [project] = await db.select().from(projects);
    await db.insert(repositories).values({
      projectId: project.id,
      source: "linear",
      externalId: "team-ops",
      fullName: "OPS",
    });
    await POST(delivery(issueUpdate()));
    state.issues = [issue({ team: { id: "team-ops", key: "OPS" } })];
    const response = await POST(delivery(issueUpdate("team-ops")));
    expect(await response.json()).toEqual({ status: "synced", projects: 1 });
    expect(await db.$count(workItems)).toBe(1);
  });

  it("returns 503 when LINEAR_API_KEY is not set for a connected team", async () => {
    state.configured = false;
    expect((await POST(delivery(issueUpdate()))).status).toBe(503);
  });
});
