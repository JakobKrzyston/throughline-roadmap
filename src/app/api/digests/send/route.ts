/** GET or POST /api/digests/send: posts the weekly digest for every project that has one set up. Vercel cron calls it weekly. */
import { postToSlack } from "@/adapters/slack";
import { sendDueDigests } from "@/core/digest";
import { getDb } from "@/db/client";
import { isPublicDeployment } from "@/lib/public-deployment";

// Digests are sent one project at a time, each with a 10-second Slack timeout.
export const maxDuration = 300;

/**
 * Send the digests that are due if the caller is allowed to.
 *
 * Args:
 *   request: The incoming request. It must carry `Authorization: Bearer <CRON_SECRET>`, which
 *     Vercel cron sends automatically. Like /api/demo/reset, the route stays shut when
 *     CRON_SECRET is unset, since it posts to other people's Slack channels. A public deployment
 *     sends only demo digests, so a mirror sharing a private instance's database never sends a
 *     private project's digest a second time.
 *
 * Returns:
 *   401 without the right secret, otherwise how many digests were sent and failed.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendDueDigests(getDb(), {
    // The cron calls the production domain, so the digest links back to it.
    baseUrl: new URL(request.url).origin,
    post: postToSlack,
    demoOnly: isPublicDeployment(),
  });
  return Response.json(result);
}

export { handle as GET, handle as POST };
