/** POST /api/linear/webhook: receives Linear webhook deliveries and mirrors the issues of connected teams as work items. */
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { ZodError } from "zod";

import { linearAdapterFor } from "@/adapters/linear";
import { LinearError } from "@/adapters/linear/source";
import {
  parseLinearWebhook,
  verifyLinearSignature,
} from "@/adapters/linear/webhook";
import { syncRepositoryItem } from "@/core/work-items";
import { getDb } from "@/db/client";
import { repositories } from "@/db/schema";
import { runQueuedJobs } from "@/jobs";

// Queued jobs run after the response is sent; give them the same budget as the job route.
export const maxDuration = 300;

/**
 * Handle one webhook delivery.
 *
 * The delivery only says which issue changed: the issue is read from Linear as it is now, so a
 * replayed or late delivery syncs the current issue and changes nothing that is already up to date.
 *
 * Args:
 *   request: The delivery. Its body must be signed with LINEAR_WEBHOOK_SECRET.
 *
 * Returns:
 *   401 for a missing or bad signature, 400 for a payload Throughline cannot read, 503 when no
 *   webhook secret or API key is set or Linear cannot be read (Linear retries the delivery),
 *   otherwise 200.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "LINEAR_WEBHOOK_SECRET is not set" },
      { status: 503 },
    );
  }

  // Verify the exact bytes Linear signed, before parsing anything.
  const body = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("linear-signature");
  if (!verifyLinearSignature(secret, body, signature)) {
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }
  // As for GitHub: every genuine delivery also picks up due and retried jobs.
  after(runQueuedJobs);

  let event;
  try {
    event = parseLinearWebhook(JSON.parse(body.toString("utf8")));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return Response.json({ error: "Unreadable payload" }, { status: 400 });
    }
    throw error;
  }
  if (!event) return Response.json({ status: "ignored" });

  const db = getDb();
  // Linear sends every team's issues; read from Linear only for a team that is connected.
  const connected = await db.$count(
    repositories,
    and(
      eq(repositories.source, "linear"),
      eq(repositories.externalId, event.teamId),
    ),
  );
  if (connected === 0) return Response.json({ status: "ignored" });

  const adapter = linearAdapterFor({ isDemo: false });
  if (!adapter) {
    return Response.json(
      { error: "LINEAR_API_KEY is not set" },
      { status: 503 },
    );
  }
  let found;
  try {
    found = await adapter.readIssue(event.issueId);
  } catch (error) {
    if (error instanceof LinearError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
  if (!found) return Response.json({ status: "ignored" });

  const projects = await syncRepositoryItem(db, found.repository, found.item);
  return Response.json({ status: "synced", projects });
}
