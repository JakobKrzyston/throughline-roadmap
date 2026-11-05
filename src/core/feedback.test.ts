/** Tests for feedback grouping, the feedback board and manual feedback links. */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  events,
  feedback,
  feedbackLinks,
  outcomes,
  projects,
  proposals,
} from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import {
  type FeedbackView,
  groupFeedback,
  loadFeedbackBoard,
  saveFeedbackLink,
} from "./feedback";
import { applyProposal, ProposalError } from "./proposals";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

function item(id: string, theme: string | null = null): FeedbackView {
  return {
    id,
    title: `Feedback ${id}`,
    url: `https://example.com/${id}`,
    theme,
    receivedAt: new Date("2026-11-01"),
  };
}

describe("groupFeedback", () => {
  const roadmap = [
    { id: "o1", key: "OUT-1", title: "Export" },
    { id: "o2", key: "OUT-2", title: "Schedules" },
    { id: "o3", key: "OUT-3", title: "SSO" },
  ];

  it("orders outcomes by how much feedback asks for them, ties in priority order", () => {
    const board = groupFeedback({
      outcomes: roadmap,
      feedback: [item("a"), item("b"), item("c")],
      links: [
        { feedbackId: "a", outcomeId: "o3" },
        { feedbackId: "b", outcomeId: "o3" },
        { feedbackId: "c", outcomeId: "o2" },
      ],
      pendingMatches: new Map(),
    });

    expect(
      board.outcomes.map((o) => [o.key, o.feedback.map((f) => f.id)]),
    ).toEqual([
      ["OUT-3", ["a", "b"]],
      ["OUT-2", ["c"]],
      ["OUT-1", []],
    ]);
    expect(board.gaps).toEqual([]);
  });

  it("groups unlinked feedback by theme, ignoring case, with unsorted feedback last", () => {
    const board = groupFeedback({
      outcomes: roadmap,
      feedback: [
        item("a", "Mobile app"),
        item("b", null),
        item("c", "Dark mode"),
        item("d", "dark mode"),
      ],
      links: [],
      pendingMatches: new Map(),
    });

    expect(
      board.gaps.map((g) => [g.theme, g.feedback.map((f) => f.id)]),
    ).toEqual([
      ["Dark mode", ["c", "d"]],
      ["Mobile app", ["a"]],
      [null, ["b"]],
    ]);
  });

  it("puts feedback with a pending match in review, not in the gaps", () => {
    const board = groupFeedback({
      outcomes: roadmap,
      feedback: [item("a", "Excel"), item("b", "Dark mode")],
      links: [],
      pendingMatches: new Map([["a", "OUT-1"]]),
    });

    expect(board.inReview).toEqual([
      { ...item("a", "Excel"), outcomeKey: "OUT-1" },
    ]);
    expect(board.gaps.map((g) => g.theme)).toEqual(["Dark mode"]);
  });

  it("treats feedback linked only to an outcome that is not live as a gap", () => {
    const board = groupFeedback({
      outcomes: roadmap,
      feedback: [item("a", "Old idea")],
      links: [{ feedbackId: "a", outcomeId: "archived" }],
      pendingMatches: new Map(),
    });

    expect(board.gaps.map((g) => g.theme)).toEqual(["Old idea"]);
  });
});

describe("feedback against the demo seed", () => {
  let db: TestDb;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDb();
    projectId = await seedDemoProject(db);
  });

  async function feedbackId(title: string): Promise<string> {
    const [row] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.title, title));
    return row.id;
  }

  it("loads linked feedback, pending matches and gaps", async () => {
    const board = await loadFeedbackBoard(db, projectId);

    expect(board.outcomes[0].key).toBe("OUT-1");
    // Seeded in one insert, so they share a timestamp and their order is not fixed.
    expect(board.outcomes[0].feedback.map((f) => f.title).sort()).toEqual([
      "Excel export would save me an hour every Monday",
      "Finance needs our reports in Excel, not CSV",
    ]);
    expect(board.inReview).toMatchObject([
      {
        title: "Can I send a dashboard to a client who has no account?",
        outcomeKey: "OUT-5",
      },
    ]);
    expect(board.gaps.map((g) => [g.theme, g.feedback.length])).toEqual([
      ["Dark mode", 2],
      ["Mobile app", 1],
    ]);
  });

  it("leaves withdrawn feedback out", async () => {
    await db
      .update(feedback)
      .set({ withdrawn: true })
      .where(eq(feedback.theme, "Dark mode"));

    const board = await loadFeedbackBoard(db, projectId);

    expect(board.gaps.map((g) => g.theme)).toEqual(["Mobile app"]);
  });

  it("links feedback by hand through an approved proposal with an event", async () => {
    const id = await feedbackId("Let us check dashboards on a phone");

    await saveFeedbackLink(
      db,
      projectId,
      { feedbackId: id, outcomeKey: "OUT-4", link: true },
      "planner",
    );

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.triggerFeedbackId, id),
          eq(proposals.source, "manual"),
        ),
      );
    expect(proposal).toMatchObject({
      status: "approved",
      decidedBy: "planner",
    });
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.proposalId, proposal.id));
    const [outcome] = await db
      .select()
      .from(outcomes)
      .where(eq(outcomes.key, "OUT-4"));
    expect(event).toMatchObject({
      type: "link_feedback",
      entityType: "outcome",
      entityId: outcome.id,
      actor: "planner",
      productNote: null,
    });
    expect(
      await db.$count(feedbackLinks, eq(feedbackLinks.feedbackId, id)),
    ).toBe(1);
  });

  it("supersedes a pending match when a person links the feedback", async () => {
    const id = await feedbackId(
      "Can I send a dashboard to a client who has no account?",
    );

    await saveFeedbackLink(
      db,
      projectId,
      { feedbackId: id, outcomeKey: "OUT-5", link: true },
      "planner",
    );

    const [match] = await db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.triggerFeedbackId, id),
          eq(proposals.source, "feedback_match"),
        ),
      );
    expect(match).toMatchObject({ status: "superseded", decidedBy: "planner" });
  });

  it("unlinks feedback, which then counts as a gap", async () => {
    const id = await feedbackId("Our main dashboard takes 20 seconds to open");

    await saveFeedbackLink(
      db,
      projectId,
      { feedbackId: id, outcomeKey: "OUT-4", link: false },
      "planner",
    );

    const board = await loadFeedbackBoard(db, projectId);
    expect(board.gaps.map((g) => g.theme)).toContain("Faster dashboards");
  });

  it("refuses to link feedback twice or unlink what is not linked, changing nothing", async () => {
    const id = await feedbackId("Our main dashboard takes 20 seconds to open");
    const before = await db.$count(events);

    await expect(
      saveFeedbackLink(
        db,
        projectId,
        { feedbackId: id, outcomeKey: "OUT-4", link: true },
        "planner",
      ),
    ).rejects.toThrow(ProposalError);
    await expect(
      saveFeedbackLink(
        db,
        projectId,
        { feedbackId: id, outcomeKey: "OUT-1", link: false },
        "planner",
      ),
    ).rejects.toThrow("OUT-1 is not linked to feedback");
    expect(await db.$count(events)).toBe(before);
  });

  it("refuses to link feedback from another project", async () => {
    const id = await feedbackId("Let us check dashboards on a phone");
    const otherProject = await seedOtherProject(db);
    const [proposal] = await db
      .insert(proposals)
      .values({
        projectId: otherProject,
        source: "manual",
        summary: "Cross-project link",
        operations: [
          { type: "link_feedback", outcome_key: "OUT-1", feedback_id: id },
        ],
      })
      .returning();

    await expect(applyProposal(db, proposal.id, "planner")).rejects.toThrow(
      `Feedback ${id} not found`,
    );
  });
});

async function seedOtherProject(db: TestDb): Promise<string> {
  const [project] = await db
    .insert(projects)
    .values({ name: "Other", slug: "other" })
    .returning();
  const [proposal] = await db
    .insert(proposals)
    .values({
      projectId: project.id,
      source: "import",
      summary: "Roadmap",
      operations: [
        { type: "create_outcome", key: "OUT-1", title: "Other outcome" },
      ],
    })
    .returning();
  await applyProposal(db, proposal.id, "pm");
  return project.id;
}
