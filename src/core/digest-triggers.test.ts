/** Tests for digests outside the weekly schedule: on demand, at milestones and on releases. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jobs, projects, proposals, repositories } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { JobPayloads } from "@/jobs/queue";

import {
  queueReleaseDigests,
  runDigestJob,
  sendDigestNow,
} from "./digest-triggers";
import type { GraphOperationInput } from "./operations";
import { applyProposal } from "./proposals";
import { approveProposal } from "./review";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const BASE = "https://throughline.example";
const WEBHOOK = "https://hooks.slack.com/services/T000/B000/abc123";
const REPOSITORY = { externalId: "4242", fullName: "acme/analytics" };

let db: TestDb;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  [{ id: projectId }] = await db
    .insert(projects)
    .values({ name: "Acme", slug: "acme", digestSlackWebhookUrl: WEBHOOK })
    .returning();
  await applyProposal(
    db,
    await propose([
      { type: "create_outcome", key: "OUT-1", title: "Export to Excel" },
      {
        type: "create_requirement",
        key: "TL-1",
        outcome_key: "OUT-1",
        title: "CSV download",
        user_visible: true,
        product_note: "Customers can download reports as CSV.",
      },
      {
        type: "create_requirement",
        key: "TL-2",
        outcome_key: "OUT-1",
        title: "Excel download",
        user_visible: true,
      },
    ]),
    "pm",
  );
});

async function propose(operations: GraphOperationInput[]): Promise<string> {
  const [proposal] = await db
    .insert(proposals)
    .values({ projectId, source: "reconcile", summary: "Test", operations })
    .returning();
  return proposal.id;
}

const finish = (key: string, note?: string): GraphOperationInput[] => [
  {
    type: "set_status",
    requirement_key: key,
    status: "done",
    product_note: note,
  },
];

async function digestJobs(): Promise<JobPayloads["digest"][]> {
  const rows = await db.select().from(jobs).where(eq(jobs.type, "digest"));
  return rows.map((row) => row.payload as JobPayloads["digest"]);
}

describe("milestones", () => {
  it("queues one when an approval makes an outcome partially available, then delivered", async () => {
    const queued = await approveProposal(
      db,
      await propose(finish("TL-1")),
      "pm",
      {
        baseUrl: BASE,
      },
    );

    expect(queued).toBe(1);
    const [outcome] = await digestJobs();
    expect(outcome).toMatchObject({
      kind: "milestone",
      projectId,
      status: "partially_available",
      baseUrl: BASE,
    });

    await approveProposal(db, await propose(finish("TL-2")), "pm", {
      baseUrl: BASE,
    });
    expect(
      (await digestJobs()).map((job) => job.kind === "milestone" && job.status),
    ).toEqual(["partially_available", "delivered"]);
  });

  it("queues none for work that starts, or without a digest or a base URL", async () => {
    await approveProposal(
      db,
      await propose([
        { type: "set_status", requirement_key: "TL-1", status: "in_progress" },
      ]),
      "pm",
      { baseUrl: BASE },
    );
    await approveProposal(db, await propose(finish("TL-1")), "pm");
    expect(await digestJobs()).toEqual([]);

    await db.update(projects).set({ digestSlackWebhookUrl: null });
    await approveProposal(db, await propose(finish("TL-2")), "pm", {
      baseUrl: BASE,
    });
    expect(await digestJobs()).toEqual([]);
  });

  it("does not announce an outcome that went back", async () => {
    await approveProposal(
      db,
      await propose([...finish("TL-1"), ...finish("TL-2")]),
      "pm",
      { baseUrl: BASE },
    );
    expect(await digestJobs()).toMatchObject([{ status: "delivered" }]);

    // More work planned: delivered becomes partially available, which is not news to announce.
    await approveProposal(
      db,
      await propose([
        {
          type: "create_requirement",
          key: "TL-3",
          outcome_key: "OUT-1",
          title: "PDF download",
        },
      ]),
      "pm",
      { baseUrl: BASE },
    );
    expect(await digestJobs()).toHaveLength(1);
  });

  it("posts what customers can now use", async () => {
    await approveProposal(
      db,
      await propose(finish("TL-1", "CSV export is live.")),
      "pm",
      { baseUrl: BASE },
    );
    const [payload] = await digestJobs();
    const post = vi.fn(async () => {});

    await runDigestJob(db, payload, post);

    expect(post).toHaveBeenCalledWith(
      WEBHOOK,
      [
        'Acme: "Export to Excel" is now partially available',
        "",
        "Customers can use part of this today.",
        "• CSV export is live.",
        "",
        "The full roadmap: https://throughline.example/p/acme",
      ].join("\n"),
    );
  });

  it("sends nothing when the milestone no longer holds or the digest was stopped", async () => {
    await approveProposal(db, await propose(finish("TL-1")), "pm", {
      baseUrl: BASE,
    });
    const [payload] = (await digestJobs()) as Extract<
      JobPayloads["digest"],
      { kind: "milestone" }
    >[];
    const post = vi.fn(async () => {});

    // Delivered before the job ran: the newer milestone tells that story.
    await applyProposal(db, await propose(finish("TL-2")), "pm");
    await runDigestJob(db, payload, post);
    await db.update(projects).set({ digestSlackWebhookUrl: null });
    await runDigestJob(db, { ...payload, status: "delivered" }, post);

    expect(post).not.toHaveBeenCalled();
  });
});

describe("release digests", () => {
  const release = (publishedAt: string) => ({
    repository: REPOSITORY,
    name: "Version 2.1",
    publishedAt: new Date(publishedAt),
  });

  beforeEach(async () => {
    await db.insert(repositories).values({
      projectId,
      source: "github",
      externalId: REPOSITORY.externalId,
      fullName: REPOSITORY.fullName,
      createdAt: new Date("2026-10-01T00:00:00Z"),
    });
  });

  it("queues one per release, covering the changes since the previous one", async () => {
    expect(
      await queueReleaseDigests(db, release("2026-11-01T00:00:00Z"), BASE),
    ).toBe(1);
    expect(
      await queueReleaseDigests(db, release("2026-11-08T00:00:00Z"), BASE),
    ).toBe(1);

    expect(await digestJobs()).toMatchObject([
      {
        kind: "release",
        releaseName: "Version 2.1",
        since: "2026-10-01T00:00:00.000Z",
      },
      { kind: "release", since: "2026-11-01T00:00:00.000Z" },
    ]);
  });

  it("ignores a replayed or older release", async () => {
    await queueReleaseDigests(db, release("2026-11-08T00:00:00Z"), BASE);

    expect(
      await queueReleaseDigests(db, release("2026-11-08T00:00:00Z"), BASE),
    ).toBe(0);
    expect(
      await queueReleaseDigests(db, release("2026-11-01T00:00:00Z"), BASE),
    ).toBe(0);
    expect(await digestJobs()).toHaveLength(1);
  });

  it("records the release without a digest, so a later one starts from it", async () => {
    await db.update(projects).set({ digestSlackWebhookUrl: null });
    expect(
      await queueReleaseDigests(db, release("2026-11-01T00:00:00Z"), BASE),
    ).toBe(0);

    await db.update(projects).set({ digestSlackWebhookUrl: WEBHOOK });
    await queueReleaseDigests(db, release("2026-11-08T00:00:00Z"), BASE);
    expect(await digestJobs()).toMatchObject([
      { since: "2026-11-01T00:00:00.000Z" },
    ]);
  });

  it("posts the changes since the last release", async () => {
    await applyProposal(
      db,
      await propose(finish("TL-1", "CSV export is live.")),
      "pm",
    );
    const post = vi.fn(async () => {});

    await runDigestJob(
      db,
      {
        kind: "release",
        projectId,
        releaseName: "Version 2.1",
        since: new Date(Date.now() - 60_000).toISOString(),
        baseUrl: BASE,
      },
      post,
    );

    const [, text] = post.mock.calls[0] as unknown as [string, string];
    expect(text).toMatch(/^Acme: Version 2\.1 is out\n/);
    expect(text).toContain("What changed since the last release\n");
    expect(text).toContain("• CSV export is live. (Export to Excel)");
  });
});

describe("sendDigestNow", () => {
  it("sends the weekly digest without moving the weekly schedule", async () => {
    const post = vi.fn(async () => {});

    expect(await sendDigestNow(db, "acme", { baseUrl: BASE, post })).toBe(
      "sent",
    );
    expect(post).toHaveBeenCalledWith(
      WEBHOOK,
      expect.stringContaining("Acme: roadmap update,"),
    );
    const [project] = await db.select().from(projects);
    expect(project.digestSentAt).toBeNull();
  });

  it("reports an unknown project or one without a digest", async () => {
    const post = vi.fn(async () => {});

    expect(await sendDigestNow(db, "nope", { baseUrl: BASE, post })).toBe(
      "not_found",
    );
    await db.update(projects).set({ digestSlackWebhookUrl: null });
    expect(await sendDigestNow(db, "acme", { baseUrl: BASE, post })).toBe(
      "not_set_up",
    );
    expect(post).not.toHaveBeenCalled();
  });
});
