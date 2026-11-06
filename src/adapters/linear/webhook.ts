/** Verifies and reads Linear webhook deliveries. Exports verifyLinearSignature, isFreshDelivery, parseLinearWebhook, MAX_DELIVERY_AGE_MS. */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// Only the ids are read: the issue itself is read fresh from Linear, which reports whether its
// assignee is an app user and gives every issue the same shape as the backfill.
const issueEvent = z.object({
  type: z.literal("Issue"),
  action: z.string(),
  data: z.object({ id: z.string(), teamId: z.string() }),
});

/**
 * Check a delivery's `Linear-Signature` header against the webhook's signing secret.
 *
 * Args:
 *   secret: The signing secret shown on the Linear webhook.
 *   body: The raw request body, exactly as received.
 *   signature: The header value, a hex HMAC-SHA256 of the body, or null if it was missing.
 *
 * Returns:
 *   True only if the signature matches.
 */
export function verifyLinearSignature(
  secret: string,
  body: Buffer,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(body).digest("hex"),
  );
  const actual = Buffer.from(signature);
  // timingSafeEqual throws on different lengths, and a length mismatch reveals nothing about the secret.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** How far a delivery's timestamp may be from now, as Linear's docs recommend, so a captured
 * delivery cannot be replayed later. */
export const MAX_DELIVERY_AGE_MS = 60_000;

/**
 * Check that a delivery was sent within the last minute, from the `webhookTimestamp` Linear puts
 * in every payload. Call it only after the signature is verified, which covers the timestamp.
 *
 * Args:
 *   payload: The parsed JSON body.
 *   now: The current time in milliseconds, for tests.
 *
 * Returns:
 *   True when the timestamp is present and within MAX_DELIVERY_AGE_MS of now.
 */
export function isFreshDelivery(payload: unknown, now = Date.now()): boolean {
  const sent = z.object({ webhookTimestamp: z.number() }).safeParse(payload)
    .data?.webhookTimestamp;
  return sent !== undefined && Math.abs(now - sent) <= MAX_DELIVERY_AGE_MS;
}

/**
 * Read which issue a delivery is about.
 *
 * Args:
 *   payload: The parsed JSON body.
 *
 * Returns:
 *   The issue's and its team's Linear ids, or null for any other kind of delivery and for a
 *   removed issue, which Throughline keeps as it last saw it.
 *
 * Raises:
 *   ZodError: An issue delivery is missing its ids.
 */
export function parseLinearWebhook(
  payload: unknown,
): { issueId: string; teamId: string } | null {
  if (
    z.object({ type: z.string() }).safeParse(payload).data?.type !== "Issue"
  ) {
    return null;
  }
  const event = issueEvent.parse(payload);
  if (event.action === "remove") return null;
  return { issueId: event.data.id, teamId: event.data.teamId };
}
