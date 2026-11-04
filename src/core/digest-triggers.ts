/** Digests sent outside the weekly schedule: on demand, at milestones and on releases. Exports sendDigestNow, buildMilestone, watchMilestones, queueMilestones, queueReleaseDigests, runDigestJob. */
import { and, eq, isNull, lt, or } from "drizzle-orm";

import type { SourceRepository } from "@/adapters/source";
import type { Database } from "@/db/client";
import { projects, proposals, repositories } from "@/db/schema";
import { enqueue, type JobPayloads } from "@/jobs/queue";

import {
  buildDigest,
  DIGEST_CHANGE_LIMIT,
  type DigestPoster,
  loadDigest,
} from "./digest";
import { PRODUCT_STATUS_TEXT } from "./product-text";
import {
  availableToday,
  loadRecentChanges,
  loadRoadmap,
  type OutcomeTree,
} from "./roadmap";
import { type ProductStatus, productStatus } from "./rollup";

type MilestoneStatus = Extract<
  ProductStatus,
  "partially_available" | "delivered"
>;

// Product statuses in the order an outcome moves through them. Only a step forward is news.
const STATUS_ORDER: ProductStatus[] = [
  "not_started",
  "in_progress",
  "partially_available",
  "delivered",
];
const MILESTONE_STATUSES: ProductStatus[] = [
  "partially_available",
  "delivered",
];

/**
 * Send a project's weekly digest now, outside the schedule. The next weekly send is unchanged.
 *
 * Args:
 *   db: Database to read.
 *   slug: The project's slug.
 *   options.baseUrl: The app's origin, for the roadmap link.
 *   options.post: Sends the digest.
 *
 * Returns:
 *   "sent", "not_found" for an unknown project, or "not_set_up" when it has no webhook.
 *
 * Raises:
 *   Error: From `post`, when the destination did not accept the digest.
 */
export async function sendDigestNow(
  db: Database,
  slug: string,
  options: { baseUrl: string; post: DigestPoster },
): Promise<"sent" | "not_found" | "not_set_up"> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return "not_found";
  if (!project.digestSlackWebhookUrl) return "not_set_up";
  const text = await loadDigest(db, project, options.baseUrl);
  await options.post(project.digestSlackWebhookUrl, text);
  return "sent";
}

/**
 * Write the message for an outcome that customers can now use some or all of.
 *
 * Args:
 *   input.projectName: The project's name.
 *   input.outcome: The outcome, as it is now.
 *   input.status: Its new product status.
 *   input.roadmapUrl: Link to the project's product view.
 *
 * Returns:
 *   Plain text: the news, then what customers can use today.
 */
export function buildMilestone(input: {
  projectName: string;
  outcome: OutcomeTree;
  status: MilestoneStatus;
  roadmapUrl: string;
}): string {
  const status = PRODUCT_STATUS_TEXT[input.status];
  return [
    `${input.projectName}: "${input.outcome.title}" is now ${status.label.toLowerCase()}`,
    "",
    status.summary,
    ...availableToday(input.outcome.requirements).map(
      (item) => `• ${item.text}`,
    ),
    "",
    `The full roadmap: ${input.roadmapUrl}`,
  ].join("\n");
}

/**
 * Before a proposal is applied, note each outcome's product status, if its project has a digest.
 *
 * Args:
 *   tx: The transaction the proposal will be applied in.
 *   proposalId: The proposal about to be applied.
 *
 * Returns:
 *   The project and its roadmap now, or null when the project has no digest (or there is no
 *   such proposal, which applyProposal then reports).
 */
export async function watchMilestones(
  tx: Database,
  proposalId: string,
): Promise<{ projectId: string; before: OutcomeTree[] } | null> {
  const [row] = await tx
    .select({
      projectId: projects.id,
      webhook: projects.digestSlackWebhookUrl,
    })
    .from(proposals)
    .innerJoin(projects, eq(proposals.projectId, projects.id))
    .where(eq(proposals.id, proposalId));
  if (!row?.webhook) return null;
  return {
    projectId: row.projectId,
    before: await loadRoadmap(tx, row.projectId),
  };
}

/**
 * After a proposal is applied, queue a milestone for each outcome that became partially
 * available or delivered.
 *
 * Args:
 *   tx: The transaction the proposal was applied in, so the jobs exist only if it commits.
 *   watched: What watchMilestones noted before the proposal was applied.
 *   baseUrl: The app's origin, for the roadmap link.
 *
 * Returns:
 *   How many milestones were queued.
 */
export async function queueMilestones(
  tx: Database,
  watched: { projectId: string; before: OutcomeTree[] },
  baseUrl: string,
): Promise<number> {
  const before = new Map(
    watched.before.map((o) => [o.id, productStatus(o.requirements)]),
  );
  const after = await loadRoadmap(tx, watched.projectId);
  let queued = 0;
  for (const outcome of after) {
    const status = productStatus(outcome.requirements);
    const was = before.get(outcome.id);
    // A new outcome is news in the weekly digest, not a milestone; so is one that went back,
    // e.g. delivered to partially available because more work was planned.
    if (was === undefined) continue;
    if (STATUS_ORDER.indexOf(status) <= STATUS_ORDER.indexOf(was)) continue;
    if (!MILESTONE_STATUSES.includes(status)) continue;
    await enqueue(tx, "digest", {
      kind: "milestone",
      projectId: watched.projectId,
      outcomeId: outcome.id,
      status: status as MilestoneStatus,
      baseUrl,
    });
    queued += 1;
  }
  return queued;
}

/**
 * Record a published release on a repository, and queue a release digest for each connected
 * project that has a digest.
 *
 * A release no newer than the last one recorded is ignored, so a replayed or late delivery
 * sends nothing.
 *
 * Args:
 *   db: Database to write to.
 *   release.repository: The repository the release was published in.
 *   release.name: The release's name, e.g. "Version 2.1".
 *   release.publishedAt: When it was published.
 *   baseUrl: The app's origin, for the roadmap link.
 *
 * Returns:
 *   How many digests were queued.
 */
export async function queueReleaseDigests(
  db: Database,
  release: { repository: SourceRepository; name: string; publishedAt: Date },
  baseUrl: string,
): Promise<number> {
  const rows = await db
    .select({
      id: repositories.id,
      projectId: repositories.projectId,
      lastReleaseAt: repositories.lastReleaseAt,
      connectedAt: repositories.createdAt,
      webhook: projects.digestSlackWebhookUrl,
    })
    .from(repositories)
    .innerJoin(projects, eq(repositories.projectId, projects.id))
    .where(
      and(
        eq(repositories.source, "github"),
        eq(repositories.externalId, release.repository.externalId),
      ),
    );

  let queued = 0;
  for (const row of rows) {
    await db.transaction(async (tx) => {
      // Recorded even without a digest, so one set up later starts from the right release.
      const [claimed] = await tx
        .update(repositories)
        .set({ lastReleaseAt: release.publishedAt })
        .where(
          and(
            eq(repositories.id, row.id),
            or(
              isNull(repositories.lastReleaseAt),
              lt(repositories.lastReleaseAt, release.publishedAt),
            ),
          ),
        )
        .returning({ id: repositories.id });
      if (!claimed || !row.webhook) return;
      await enqueue(tx, "digest", {
        kind: "release",
        projectId: row.projectId,
        releaseName: release.name,
        since: (row.lastReleaseAt ?? row.connectedAt).toISOString(),
        baseUrl,
      });
      queued += 1;
    });
  }
  return queued;
}

/**
 * Run a `digest` job: write the milestone or release digest and post it.
 *
 * Nothing is sent when the project has stopped its digest since, or when a milestone no longer
 * holds (the outcome was archived or its status changed again before the job ran).
 *
 * Args:
 *   db: Database to read.
 *   payload: The job's payload.
 *   post: Sends the digest.
 *
 * Raises:
 *   Error: From `post`; the queue retries the job.
 */
export async function runDigestJob(
  db: Database,
  payload: JobPayloads["digest"],
  post: DigestPoster,
): Promise<void> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, payload.projectId));
  if (!project?.digestSlackWebhookUrl) return;
  const roadmapUrl = `${payload.baseUrl}/p/${project.slug}`;
  const roadmap = await loadRoadmap(db, project.id);

  let text: string;
  if (payload.kind === "milestone") {
    const outcome = roadmap.find((o) => o.id === payload.outcomeId);
    if (!outcome || productStatus(outcome.requirements) !== payload.status) {
      return;
    }
    text = buildMilestone({
      projectName: project.name,
      outcome,
      status: payload.status,
      roadmapUrl,
    });
  } else {
    // One more than is shown, to tell whether there were more.
    const changes = await loadRecentChanges(
      db,
      project.id,
      roadmap,
      new Date(payload.since),
      DIGEST_CHANGE_LIMIT + 1,
    );
    text = buildDigest({
      title: `${project.name}: ${payload.releaseName} is out`,
      changesHeading: "What changed since the last release",
      roadmap,
      changes: changes.slice(0, DIGEST_CHANGE_LIMIT),
      moreChanges: changes.length > DIGEST_CHANGE_LIMIT,
      roadmapUrl,
    });
  }
  await post(project.digestSlackWebhookUrl, text);
}
