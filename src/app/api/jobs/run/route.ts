/** GET or POST /api/jobs/run: runs due jobs. Vercel cron calls it with GET as a safety net. */
import { runQueuedJobs } from "@/jobs";

export const maxDuration = 300;

/**
 * Run due jobs if the caller is allowed to.
 *
 * When CRON_SECRET is set, the request must carry `Authorization: Bearer <CRON_SECRET>`, which
 * Vercel cron sends automatically. Without it the route is open, which is fine locally: it only
 * runs jobs that are already queued.
 *
 * Args:
 *   request: The incoming request.
 *
 * Returns:
 *   401 without the right secret, otherwise how many jobs finished and failed.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await runQueuedJobs());
}

export { handle as GET, handle as POST };
