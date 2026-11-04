/** The origin links to this app should use, e.g. in digests. Exports appOrigin. */
import { headers } from "next/headers";

/**
 * Where links to this app should point.
 *
 * On Vercel this is the production domain, so a digest sent from a preview deploy still links to
 * the real site, and request headers are never trusted for it. Elsewhere, such as a local copy,
 * it is the origin the browser used.
 *
 * Returns:
 *   E.g. "https://throughline.example" or "http://localhost:3000".
 */
export async function appOrigin(): Promise<string> {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  const list = await headers();
  return `${list.get("x-forwarded-proto") ?? "http"}://${list.get("host")}`;
}
