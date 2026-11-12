/** The plain-language digest for non-technical stakeholders, and its weekly send. Exports buildDigest, loadDigest, sendDueDigests, DigestPoster, DIGEST_CHANGE_LIMIT. */
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

/** Most changes one digest lists; Slack messages are for skimming, and the roadmap has the rest. */
export const DIGEST_CHANGE_LIMIT = 30;

/**
 * Write a digest: what changed in some period and where each outcome stands, with no ticket numbers.
 *
 * Args:
 *   input.title: The first line, e.g. "Acme: roadmap update, 9 November 2026".
 *   input.changesHeading: Heading over the changes, e.g. "What changed since 2 November".
 *   input.roadmap: The project's live roadmap from loadRoadmap.
 *   input.changes: The period's newest changes from loadRecentChanges, newest first.
 *   input.moreChanges: True when the period had more changes than `changes` holds.
 *   input.roadmapUrl: Link to the project's product view.
 *
 * Returns:
 *   Plain text, one line per change and per outcome.
 */
export function buildDigest(input: {
  title: string;
  changesHeading: string;
  roadmap: OutcomeTree[];
  changes: RecentChange[];
  moreChanges: boolean;
  roadmapUrl: string;
}): string {
  // The feed is newest first; a summary reads better in the order things happened.
  const changes =
    input.changes.length === 0
      ? ["Nothing changed."]
      : [
          ...(input.moreChanges
            ? ["• Earlier changes are on the roadmap."]
            : []),
          ...input.changes
            .toReversed()
            .map((change) => `• ${change.note} (${change.outcomeTitle})`),
        ];
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
    input.title,
    "",
    input.changesHeading,
    ...changes,
    "",
    "Where things stand",
    ...outcomes,
    "",
    `The full roadmap: ${input.roadmapUrl}`,
  ].join("\n");
}

/**
 * Load a project's roadmap and the changes since its last digest, and write the digest.
 *
 * Args:
 *   db: Database to read.
 *   project: The project's id, name, slug and when its last digest went out.
 *   baseUrl: The app's origin, e.g. "https://throughline.example", for the roadmap link.
 *   now: When the digest is written. Defaults to now.
 *
 * Returns:
 *   The digest text from buildDigest. It covers the time since the last digest went out, or the
 *   past week before the first one, so a skipped or failed week is not lost.
 */
export async function loadDigest(
  db: Database,
  project: {
    id: string;
    name: string;
    slug: string;
    digestSentAt: Date | null;
  },
  baseUrl: string,
  now: Date = new Date(),
): Promise<string> {
  const since = project.digestSentAt ?? new Date(now.getTime() - 7 * DAY_MS);
  const roadmap = await loadRoadmap(db, project.id);
  // One more than is shown, to tell whether there were more.
  const changes = await loadRecentChanges(
    db,
    project.id,
    roadmap,
    since,
    DIGEST_CHANGE_LIMIT + 1,
  );
  const day = (date: Date): string =>
    date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
  return buildDigest({
    title: `${project.name}: roadmap update, ${day(now)} ${now.getUTCFullYear()}`,
    changesHeading: `What changed since ${day(since)}`,
    roadmap,
    changes: changes.slice(0, DIGEST_CHANGE_LIMIT),
    moreChanges: changes.length > DIGEST_CHANGE_LIMIT,
    roadmapUrl: `${baseUrl}/p/${project.slug}`,
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
 *   options.demoOnly: Send only demo projects' digests, as a public deployment does.
 *   options.now: The time of this run. Defaults to now.
 *
 * Returns:
 *   How many digests were sent and how many failed.
 */
export async function sendDueDigests(
  db: Database,
  options: {
    baseUrl: string;
    post: DigestPoster;
    demoOnly?: boolean;
    now?: Date;
  },
): Promise<{ sent: number; failed: number }> {
  const now = options.now ?? new Date();
  const due = or(
    isNull(projects.digestSentAt),
    lt(projects.digestSentAt, new Date(now.getTime() - RESEND_AFTER_MS)),
  );
  const rows = await db
    .select()
    .from(projects)
    .where(
      and(
        isNotNull(projects.digestSlackWebhookUrl),
        options.demoOnly ? eq(projects.isDemo, true) : undefined,
        due,
      ),
    );

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
