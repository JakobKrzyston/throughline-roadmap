/** GET or POST /api/demo/reset: rebuilds the Acme Analytics demo project. Vercel cron calls it nightly. */
import { getDb } from "@/db/client";
import { seedDemoProject } from "@/db/seed";

// The reseed runs a few hundred queries in order; allow it more than the platform default.
export const maxDuration = 300;

/**
 * Replace the demo project with a fresh copy if the caller is allowed to.
 *
 * Visitors can approve and reject the demo's proposals, so this puts them back every night. The
 * reseed runs in one transaction, so visitors see the old demo until the new one is complete.
 *
 * Args:
 *   request: The incoming request. It must carry `Authorization: Bearer <CRON_SECRET>`, which
 *     Vercel cron sends automatically. Unlike /api/jobs/run, the route stays shut when
 *     CRON_SECRET is unset, since it throws away what visitors did; locally, `pnpm db:seed` resets.
 *
 * Returns:
 *   401 without the right secret, otherwise the new demo project's id.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const projectId = await getDb().transaction((tx) => seedDemoProject(tx));
  return Response.json({ projectId });
}

export { handle as GET, handle as POST };
