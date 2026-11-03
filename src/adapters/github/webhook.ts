/** Verifies and reads GitHub webhook deliveries. Exports verifyWebhookSignature, parseWebhookEvent, WebhookEvent. */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { SourceWorkItem } from "@/adapters/source";

import {
  githubIssueSchema,
  githubPullSchema,
  issueToWorkItem,
  pullToWorkItem,
} from "./work-items";

/** A delivery that changes a work item in a repository. */
export type WebhookEvent = {
  /** GitHub's numeric repository id, as a string. */
  repositoryExternalId: string;
  item: SourceWorkItem;
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
    return {
      repositoryExternalId: String(event.repository.id),
      item: issueToWorkItem(event.repository.full_name, event.issue),
    };
  }
  if (eventName === "pull_request") {
    const event = pullRequestEvent.parse(payload);
    return {
      repositoryExternalId: String(event.repository.id),
      item: pullToWorkItem(event.repository.full_name, event.pull_request),
    };
  }
  return null;
}
