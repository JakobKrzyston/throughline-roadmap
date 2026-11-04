/** POST /api/github/webhook: receives GitHub App deliveries, mirrors issues and PRs, links explicit references, and queues release digests. */
import { after } from "next/server";
import { ZodError } from "zod";

import {
  parseReleaseEvent,
  parseWebhookEvent,
  verifyWebhookSignature,
} from "@/adapters/github/webhook";
import { queueReleaseDigests } from "@/core/digest-triggers";
import { syncRepositoryItem } from "@/core/work-items";
import { getDb } from "@/db/client";
import { runQueuedJobs } from "@/jobs";

// Queued jobs run after the response is sent; give them the same budget as the job route.
export const maxDuration = 300;

/**
 * Handle one webhook delivery.
 *
 * Args:
 *   request: The delivery. Its body must be signed with GITHUB_WEBHOOK_SECRET.
 *
 * Returns:
 *   401 for a missing or bad signature, 400 for a payload Throughline cannot read, 503 when no
 *   webhook secret is set, otherwise 200.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "GITHUB_WEBHOOK_SECRET is not set" },
      { status: 503 },
    );
  }

  // Verify the exact bytes GitHub signed, before parsing anything.
  const body = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(secret, body, signature)) {
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }
  // Every genuine delivery runs the queue after responding, whether or not it queued anything.
  // That is how retries and jobs cut off by a timeout get picked up between the daily crons; when
  // nothing is due the run is one quick lookup.
  after(runQueuedJobs);

  const eventName = request.headers.get("x-github-event");
  let event;
  let release;
  try {
    const payload = JSON.parse(body.toString("utf8"));
    release = parseReleaseEvent(eventName, payload);
    event = parseWebhookEvent(eventName, payload);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return Response.json({ error: "Unreadable payload" }, { status: 400 });
    }
    throw error;
  }
  if (release) {
    const queued = await queueReleaseDigests(
      getDb(),
      release,
      new URL(request.url).origin,
    );
    return Response.json({ status: "release", digests: queued });
  }
  if (!event) return Response.json({ status: "ignored" });

  const results = await syncRepositoryItem(
    getDb(),
    event.repository,
    event.item,
  );
  return Response.json({ status: "synced", projects: results.length });
}
