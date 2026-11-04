/** The weekly plain-language digest for non-technical stakeholders. Exports buildDigest, loadDigest, sendDueDigests. */
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { Database } from "@/db/client";
import { projects } from "@/db/schema";

import { formatTarget, PRODUCT_STATUS_TEXT } from "./product-text";
import {
  loadRecentChanges,
  loadRoadmap,
  type OutcomeTree,
  type RecentChange,
} from "./roadmap";
import { outcomeProgress, productStatus } from "./rollup";

const DAY_MS = 24 * 60 * 60 * 1000;
// A digest counts as sent for the week if it went out in the last six days, not seven, so a
// weekly cron that fires a little early still sends.
const RESEND_AFTER_MS = 6 * DAY_MS;

/** Posts a digest's text to one destination, e.g. postToSlack in src/adapters/slack.ts. */
export type DigestPoster = (webhookUrl: string, text: string) => Promise<void>;

/**
 * Write the digest: what changed this week and where each outcome stands, with no ticket numbers.
 *
 * Args:
 *   input.projectName: The project's name, for the first line.
 *   input.roadmap: The project's live roadmap from loadRoadmap.
 *   input.changes: This week's changes from loadRecentChanges.
 *   input.roadmapUrl: Link to the project's product view.
 *   input.now: When the digest is written; its date ends the week.
 *
 * Returns:
 *   Plain text, one line per change and per outcome.
 */
export function buildDigest(input: {
  projectName: string;
  roadmap: OutcomeTree[];
  changes: RecentChange[];
  roadmapUrl: string;
  now: Date;
}): string {
  const weekTo = input.now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  // The feed is newest first; a summary reads better in the order things happened.
  const changes =
    input.changes.length === 0
      ? ["Nothing changed this week."]
      : input.changes
          .toReversed()
          .map((change) => `• ${change.note} (${change.outcomeTitle})`);
  const outcomes =
    input.roadmap.length === 0
      ? ["The roadmap is empty."]
      : input.roadmap.map((outcome) => {
          const status =
            PRODUCT_STATUS_TEXT[productStatus(outcome.requirements)].label;
          const percent = Math.round(
            outcomeProgress(outcome.requirements) * 100,
          );
          const target = outcome.target
            ? `target ${formatTarget(outcome.target)}`
            : "no target date yet";
          return `• ${outcome.title}: ${status}, ${percent}% done, ${target}.`;
        });

  return [
    `${input.projectName}: roadmap update for the week to ${weekTo}`,
    "",
    "What changed this week",
    ...changes,
    "",
    "Where things stand",
    ...outcomes,
    "",
    `The full roadmap: ${input.roadmapUrl}`,
  ].join("\n");
}

/**
 * Load a project's roadmap and this week's changes, and write its digest.
 *
 * Args:
 *   db: Database to read.
 *   project: The project's id, name and slug.
 *   baseUrl: The app's origin, e.g. "https://throughline.example", for the roadmap link.
 *   now: When the digest is written. Defaults to now.
 *
 * Returns:
 *   The digest text from buildDigest.
 */
export async function loadDigest(
  db: Database,
  project: { id: string; name: string; slug: string },
  baseUrl: string,
  now: Date = new Date(),
): Promise<string> {
  const roadmap = await loadRoadmap(db, project.id);
  const changes = await loadRecentChanges(
    db,
    project.id,
    roadmap,
    new Date(now.getTime() - 7 * DAY_MS),
  );
  return buildDigest({
    projectName: project.name,
    roadmap,
    changes,
    roadmapUrl: `${baseUrl}/p/${project.slug}`,
    now,
  });
}

/**
 * Send the weekly digest for every project that has a destination and has not had one this week.
 *
 * A failed send is logged and does not stop the others; that project is due again on the next run.
 *
 * Args:
 *   db: Database to read and record sends in.
 *   options.baseUrl: The app's origin, for the roadmap link.
 *   options.post: Sends one digest.
 *   options.now: The time of this run. Defaults to now.
 *
 * Returns:
 *   How many digests were sent and how many failed.
 */
export async function sendDueDigests(
  db: Database,
  options: { baseUrl: string; post: DigestPoster; now?: Date },
): Promise<{ sent: number; failed: number }> {
  const now = options.now ?? new Date();
  const due = or(
    isNull(projects.digestSentAt),
    lt(projects.digestSentAt, new Date(now.getTime() - RESEND_AFTER_MS)),
  );
  const rows = await db
    .select()
    .from(projects)
    .where(and(isNotNull(projects.digestSlackWebhookUrl), due));

  let sent = 0;
  let failed = 0;
  for (const project of rows) {
    // Claim the week before sending, so a second run at the same time (cron can fire twice)
    // finds nothing due and does not send the digest again.
    const [claimed] = await db
      .update(projects)
      .set({ digestSentAt: now })
      .where(and(eq(projects.id, project.id), due))
      .returning({ id: projects.id });
    if (!claimed) continue;

    try {
      const text = await loadDigest(db, project, options.baseUrl, now);
      await options.post(project.digestSlackWebhookUrl!, text);
      sent += 1;
    } catch (error) {
      console.error(`Digest for ${project.slug} failed:`, error);
      await db
        .update(projects)
        .set({ digestSentAt: project.digestSentAt })
        .where(eq(projects.id, project.id));
      failed += 1;
    }
  }
  return { sent, failed };
}
