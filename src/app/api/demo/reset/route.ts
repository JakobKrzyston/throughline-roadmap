/** GET or POST /api/demo/reset: rebuilds the Acme Analytics demo project. Vercel cron calls it nightly. */
import { getDb } from "@/db/client";
import { seedDemoProject } from "@/db/seed";

/**
 * Replace the demo project with a fresh copy if the caller is allowed to.
 *
 * Visitors can approve and reject the demo's proposals, so this puts them back every night. The
 * reseed runs in one transaction, so visitors see the old demo until the new one is complete.
 *
 * Args:
 *   request: The incoming request. When CRON_SECRET is set it must carry
 *     `Authorization: Bearer <CRON_SECRET>`, which Vercel cron sends automatically.
 *
 * Returns:
 *   401 without the right secret, otherwise the new demo project's id.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const projectId = await getDb().transaction((tx) => seedDemoProject(tx));
  return Response.json({ projectId });
}

export { handle as GET, handle as POST };
