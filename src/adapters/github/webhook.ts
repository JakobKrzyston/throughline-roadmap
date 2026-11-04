/** Verifies and reads GitHub webhook deliveries. Exports verifyWebhookSignature, parseWebhookEvent, parseReleaseEvent, WebhookEvent, ReleaseEvent. */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { SourceRepository, SourceWorkItem } from "@/adapters/source";

import {
  githubIssueSchema,
  githubPullSchema,
  issueToWorkItem,
  pullToWorkItem,
} from "./work-items";

/** A delivery that changes a work item in a repository. */
export type WebhookEvent = {
  /** The repository as the delivery reports it, so a rename shows up in its `fullName`. */
  repository: SourceRepository;
  item: SourceWorkItem;
};

/** A release published in a repository. */
export type ReleaseEvent = {
  repository: SourceRepository;
  /** The release's title, or its tag when it has none. */
  name: string;
  publishedAt: Date;
};

const repository = z.object({ id: z.number().int(), full_name: z.string() });

const issuesEvent = z.object({
  action: z.string(),
  issue: githubIssueSchema,
  repository,
});

const pullRequestEvent = z.object({
  action: z.string(),
  pull_request: githubPullSchema,
  repository,
});

const releaseEvent = z.object({
  action: z.string(),
  release: z.object({
    name: z.string().nullable(),
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.iso.datetime({ offset: true }).nullable(),
  }),
  repository,
});

/**
 * Check a delivery's `X-Hub-Signature-256` header against the webhook secret.
 *
 * Args:
 *   secret: The webhook secret configured on the GitHub App.
 *   body: The raw request body, exactly as received.
 *   signature: The header value, `sha256=<hex digest>`, or null if it was missing.
 *
 * Returns:
 *   True only if the signature matches.
 */
export function verifyWebhookSignature(
  secret: string,
  body: Buffer,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  );
  const actual = Buffer.from(signature);
  // timingSafeEqual throws on different lengths, and a length mismatch reveals nothing about the secret.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Turn an `issues` or `pull_request` delivery into the work item it describes.
 *
 * Args:
 *   eventName: The `X-GitHub-Event` header.
 *   payload: The parsed JSON body.
 *
 * Returns:
 *   The repository and work item, or null for events Throughline does not track (pings,
 *   installation changes, deleted or transferred issues).
 *
 * Raises:
 *   ZodError: An issues or pull_request payload is missing fields Throughline needs.
 */
export function parseWebhookEvent(
  eventName: string | null,
  payload: unknown,
): WebhookEvent | null {
  if (eventName === "issues") {
    const event = issuesEvent.parse(payload);
    // A deleted or transferred issue no longer lives at this URL; keep the last copy we saw.
    if (event.action === "deleted" || event.action === "transferred") {
      return null;
    }
    const repository = toRepository(event.repository);
    return {
      repository,
      item: issueToWorkItem(repository.externalId, event.issue),
    };
  }
  if (eventName === "pull_request") {
    const event = pullRequestEvent.parse(payload);
    const repository = toRepository(event.repository);
    return {
      repository,
      item: pullToWorkItem(repository.externalId, event.pull_request),
    };
  }
  return null;
}

/**
 * Read a `release` delivery for a release that was just published.
 *
 * Args:
 *   eventName: The `X-GitHub-Event` header.
 *   payload: The parsed JSON body.
 *
 * Returns:
 *   The release, or null for other events, other actions (including "published", which
 *   "released" follows for full releases), drafts and pre-releases.
 *
 * Raises:
 *   ZodError: A release payload is missing fields Throughline needs.
 */
export function parseReleaseEvent(
  eventName: string | null,
  payload: unknown,
): ReleaseEvent | null {
  if (eventName !== "release") return null;
  const { action, release, repository } = releaseEvent.parse(payload);
  // GitHub sends "released" both when a release is published and when a pre-release is
  // promoted to one, unlike "published", which also fires for pre-releases.
  if (action !== "released" || release.draft || release.prerelease) {
    return null;
  }
  if (!release.published_at) return null;
  return {
    repository: toRepository(repository),
    name: release.name?.trim() || release.tag_name,
    publishedAt: new Date(release.published_at),
  };
}

function toRepository(raw: z.output<typeof repository>): SourceRepository {
  return { externalId: String(raw.id), fullName: raw.full_name };
}
