/** Tests for POST /api/github/webhook with a signed request and an in-memory database. */
import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pullRequestPayload, REPO } from "@/adapters/github/fixtures";
import { applyProposal } from "@/core/proposals";
import {
  jobs,
  links,
  projects,
  proposals,
  repositories,
  workItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));
// after() needs a Next.js request scope; the job run it schedules is not under test here.
vi.mock("next/server", () => ({ after: vi.fn() }));

const { after } = await import("next/server");
const { runQueuedJobs } = await import("@/jobs");
const { POST } = await import("./route");

const SECRET = "webhook-secret";
let db: TestDb;

beforeEach(async () => {
  vi.mocked(after).mockClear();
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", SECRET);
  db = await createTestDb();
  state.db = db;
  const [project] = await db
    .insert(projects)
    .values({ name: "Test", slug: "test" })
    .returning();
  await db.insert(repositories).values({
    projectId: project.id,
    source: "github",
    externalId: String(REPO.id),
    fullName: REPO.full_name,
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
  options: { event?: string; secret?: string } = {},
): Request {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", options.secret ?? SECRET)
    .update(body)
    .digest("hex");
  return new Request("http://localhost/api/github/webhook", {
    method: "POST",
    headers: {
      "x-github-event": options.event ?? "pull_request",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
}

const mergedPr = pullRequestPayload(
  {
    state: "closed",
    merged_at: "2026-11-01T10:00:00Z",
    closed_at: "2026-11-01T10:00:00Z",
  },
  "closed",
);

describe("POST /api/github/webhook", () => {
  it("rejects a bad signature with 401 and writes nothing", async () => {
    const response = await POST(delivery(mergedPr, { secret: "wrong" }));
    expect(response.status).toBe(401);
    expect(await db.select().from(workItems)).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it("rejects a missing signature with 401", async () => {
    const request = delivery(mergedPr);
    request.headers.delete("x-hub-signature-256");
    expect((await POST(request)).status).toBe(401);
  });

  it("returns 503 when no webhook secret is configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    expect((await POST(delivery(mergedPr))).status).toBe(503);
  });

  it("returns 400 for a signed payload it cannot read", async () => {
    expect((await POST(delivery({ action: "opened" }))).status).toBe(400);
  });

  it("acknowledges events it does not track", async () => {
    const response = await POST(delivery({ zen: "hi" }, { event: "ping" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
  });

  it("runs due jobs after any genuine delivery, even one that queues nothing", async () => {
    // A retry or a job cut off by a timeout must not wait for a delivery that happens to queue work.
    await POST(delivery({ zen: "hi" }, { event: "ping" }));
    expect(after).toHaveBeenCalledWith(runQueuedJobs);
  });

  it("links a merged PR that references a requirement and enqueues reconciliation", async () => {
    const response = await POST(delivery(mergedPr));

    expect(response.status).toBe(200);
    const [item] = await db.select().from(workItems);
    expect(item).toMatchObject({
      externalId: "4242#41",
      state: "merged",
    });
    expect(await db.select().from(links)).toHaveLength(1);
    const queued = await db
      .select()
      .from(jobs)
      .where(eq(jobs.type, "reconcile"));
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ workItemId: item.id });
  });

  it("does not create duplicates when the same delivery is replayed", async () => {
    await POST(delivery(mergedPr));
    const replay = await POST(delivery(mergedPr));

    expect(replay.status).toBe(200);
    expect(await db.select().from(workItems)).toHaveLength(1);
    expect(await db.select().from(links)).toHaveLength(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("queues a release digest for a project with a digest, once per release", async () => {
    await db.update(projects).set({
      digestSlackWebhookUrl: "https://hooks.slack.com/services/T/B/x",
    });
    const published = {
      action: "published",
      release: {
        name: "Version 2.1",
        tag_name: "v2.1.0",
        draft: false,
        prerelease: false,
        published_at: "2026-11-08T09:00:00Z",
      },
      repository: REPO,
    };

    const response = await POST(delivery(published, { event: "release" }));
    await POST(delivery(published, { event: "release" }));

    expect(await response.json()).toEqual({ status: "release", digests: 1 });
    expect(await db.select().from(jobs)).toMatchObject([
      {
        type: "digest",
        payload: {
          kind: "release",
          releaseName: "Version 2.1",
          baseUrl: "http://localhost",
        },
      },
    ]);
  });
});
