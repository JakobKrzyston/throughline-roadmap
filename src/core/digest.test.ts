/** Tests for the weekly digest: its wording, and sending it once a week per project. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { projects } from "@/db/schema";
import { DEMO_SLUG, seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import { buildDigest, loadDigest, sendDueDigests } from "./digest";
import type { OutcomeTree, RequirementTree } from "./roadmap";

const NOW = new Date("2026-11-09T08:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const WEBHOOK = "https://hooks.slack.com/services/T000/B000/abc123";
const TICKET_NUMBER = /\b(?:TL|OUT)-\d+\b|#\d+/;

function leaf(
  key: string,
  status: RequirementTree["status"],
  userVisible = false,
): RequirementTree {
  return {
    id: key,
    key,
    title: key,
    description: "",
    productNote: null,
    splitReason: null,
    target: null,
    doneNote: null,
    workType: null,
    team: null,
    teamInherited: false,
    people: [],
    status,
    userVisible,
    children: [],
    workItems: [],
  };
}

function outcome(
  title: string,
  target: string | null,
  requirements: RequirementTree[],
): OutcomeTree {
  return {
    id: title,
    key: "OUT-1",
    title,
    description: "",
    target,
    priority: 1,
    requirements,
  };
}

describe("buildDigest", () => {
  it("lists the week's changes oldest first, then where each outcome stands", () => {
    const text = buildDigest({
      title: "Acme Analytics: roadmap update, 9 November 2026",
      changesHeading: "What changed since 2 November",
      roadmap: [
        outcome("Excel export", "2026-Q4", [
          leaf("TL-1", "done", true),
          leaf("TL-2", "planned"),
        ]),
        outcome("Single sign-on", null, []),
      ],
      changes: [
        {
          id: "2",
          note: "CSV download is live.",
          at: NOW,
          outcomeTitle: "Excel export",
          entityKey: "TL-1",
          moved: false,
        },
        {
          id: "1",
          note: "Export now has a plan.",
          at: NOW,
          outcomeTitle: "Excel export",
          entityKey: "OUT-1",
          moved: false,
        },
      ],
      moreChanges: false,
      roadmapUrl: "https://throughline.example/p/acme",
    });

    expect(text).toBe(
      [
        "Acme Analytics: roadmap update, 9 November 2026",
        "",
        "What changed since 2 November",
        "• Export now has a plan. (Excel export)",
        "• CSV download is live. (Excel export)",
        "",
        "Where things stand",
        "• Excel export: Partially available, 50% done, target Q4 2026.",
        "• Single sign-on: Not started, 0% done, no target date yet.",
        "",
        "The full roadmap: https://throughline.example/p/acme",
      ].join("\n"),
    );
  });

  it("says so when nothing changed and the roadmap is empty", () => {
    const text = buildDigest({
      title: "Empty: roadmap update",
      changesHeading: "What changed since 2 November",
      roadmap: [],
      changes: [],
      moreChanges: false,
      roadmapUrl: "https://throughline.example/p/empty",
    });

    expect(text).toContain("What changed since 2 November\nNothing changed.");
    expect(text).toContain("Where things stand\nThe roadmap is empty.");
  });

  it("says when there were more changes than it lists", () => {
    const text = buildDigest({
      title: "Busy: roadmap update",
      changesHeading: "What changed since 2 November",
      roadmap: [],
      changes: [
        {
          id: "1",
          note: "CSV download is live.",
          at: NOW,
          outcomeTitle: "Excel export",
          entityKey: "TL-1",
          moved: false,
        },
      ],
      moreChanges: true,
      roadmapUrl: "https://throughline.example/p/busy",
    });

    expect(text).toContain(
      "What changed since 2 November\n• Earlier changes are on the roadmap.\n• CSV download is live.",
    );
  });
});

describe("digests from the database", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDb();
    projectId = await seedDemoProject(db);
  });

  async function setDigest(
    values: Partial<typeof projects.$inferInsert>,
  ): Promise<void> {
    await db.update(projects).set(values).where(eq(projects.id, projectId));
  }

  async function sentAt(): Promise<Date | null> {
    const [row] = await db
      .select({ at: projects.digestSentAt })
      .from(projects)
      .where(eq(projects.id, projectId));
    return row.at;
  }

  it("writes the demo's digest in plain language, with no ticket numbers", async () => {
    const text = await loadDigest(
      db,
      {
        id: projectId,
        name: "Acme Analytics",
        slug: DEMO_SLUG,
        digestSentAt: null,
      },
      "https://throughline.example",
    );

    expect(text).toContain("Customers can now download any report as CSV.");
    expect(text).toContain(
      "• Customers can export reports to Excel and CSV: Partially available",
    );
    expect(text).toContain(
      `The full roadmap: https://throughline.example/p/${DEMO_SLUG}`,
    );
    expect(text).not.toMatch(TICKET_NUMBER);
  });

  it("covers the time since the last digest went out", async () => {
    const project = {
      id: projectId,
      name: "Acme Analytics",
      slug: DEMO_SLUG,
    };
    const twoWeeksAgo = new Date(Date.now() - 14 * DAY_MS);
    const day = twoWeeksAgo.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });

    // A missed week: the next digest still reports the seed's changes from this week.
    const late = await loadDigest(
      db,
      { ...project, digestSentAt: twoWeeksAgo },
      "https://t.example",
    );
    expect(late).toContain(`What changed since ${day}\n•`);
    expect(late).toContain("Customers can now download any report as CSV.");

    // Sent after the seed's changes: there is nothing new to report.
    const justSent = await loadDigest(
      db,
      { ...project, digestSentAt: new Date() },
      "https://t.example",
    );
    expect(justSent).toContain("\nNothing changed.\n");
  });

  it("sends once a week to projects with a webhook", async () => {
    const post = vi.fn(async () => {});
    const send = (now: Date) =>
      sendDueDigests(db, { baseUrl: "https://t.example", post, now });

    expect(await send(NOW)).toEqual({ sent: 0, failed: 0 });

    await setDigest({ digestSlackWebhookUrl: WEBHOOK });
    expect(await send(NOW)).toEqual({ sent: 1, failed: 0 });
    expect(post).toHaveBeenCalledWith(
      WEBHOOK,
      expect.stringContaining("Acme Analytics: roadmap update"),
    );
    expect(await sentAt()).toEqual(NOW);

    // A second cron call the same morning, or any day that week, sends nothing.
    expect(await send(NOW)).toEqual({ sent: 0, failed: 0 });
    expect(await send(new Date(NOW.getTime() + 5 * DAY_MS))).toEqual({
      sent: 0,
      failed: 0,
    });
    // The next Monday's run sends again, even if it fires a little early.
    expect(await send(new Date(NOW.getTime() + 7 * DAY_MS - 60_000))).toEqual({
      sent: 1,
      failed: 0,
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("leaves a failed send due for the next run", async () => {
    const lastWeek = new Date(NOW.getTime() - 7 * DAY_MS);
    await setDigest({ digestSlackWebhookUrl: WEBHOOK, digestSentAt: lastWeek });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const post = vi.fn(async () => {
      throw new Error("Slack answered 404: no_service");
    });

    expect(
      await sendDueDigests(db, {
        baseUrl: "https://t.example",
        post,
        now: NOW,
      }),
    ).toEqual({ sent: 0, failed: 1 });
    expect(await sentAt()).toEqual(lastWeek);
  });
});
