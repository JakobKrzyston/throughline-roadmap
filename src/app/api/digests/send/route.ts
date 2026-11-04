/** GET or POST /api/digests/send: posts the weekly digests that are due (Vercel cron, weekly), or one project's digest now with ?project=<slug>. */
import { postToSlack } from "@/adapters/slack";
import { sendDueDigests } from "@/core/digest";
import { sendDigestNow } from "@/core/digest-triggers";
import { getDb } from "@/db/client";

// Digests are sent one project at a time, each with a 10-second Slack timeout.
export const maxDuration = 300;

/**
 * Send the digests that are due, or one project's digest now, if the caller is allowed to.
 *
 * With `?project=<slug>`, for automation such as a CI step, that project's digest goes out now
 * whether or not it is due, and the weekly send is unchanged.
 *
 * Args:
 *   request: The incoming request. It must carry `Authorization: Bearer <CRON_SECRET>`, which
 *     Vercel cron sends automatically. Like /api/demo/reset, the route stays shut when
 *     CRON_SECRET is unset, since it posts to other people's Slack channels.
 *
 * Returns:
 *   401 without the right secret. For one project: 404 if it does not exist, 409 if it has no
 *   digest, 502 if Slack refused it, else `{ sent: 1 }`. Otherwise how many were sent and failed.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  // The caller used the production domain, so the digest links back to it.
  const options = { baseUrl: url.origin, post: postToSlack };
  const slug = url.searchParams.get("project");
  if (slug === null) {
    return Response.json(await sendDueDigests(getDb(), options));
  }

  let result;
  try {
    result = await sendDigestNow(getDb(), slug, options);
  } catch (error) {
    console.error(`Digest for ${slug} failed:`, error);
    return Response.json(
      { error: "Slack did not accept the digest" },
      { status: 502 },
    );
  }
  if (result === "not_found") {
    return Response.json({ error: "No such project" }, { status: 404 });
  }
  if (result === "not_set_up") {
    return Response.json(
      { error: "This project has no digest set up" },
      { status: 409 },
    );
  }
  return Response.json({ sent: 1 });
}

export { handle as GET, handle as POST };
