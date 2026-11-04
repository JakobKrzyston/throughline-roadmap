/** The origin the current request was made to, for absolute links. Exports requestOrigin. */
import { headers } from "next/headers";

/**
 * The scheme and host the browser used to reach this server, behind a proxy such as Vercel's.
 *
 * Returns:
 *   E.g. "https://throughline.example" or "http://localhost:3000".
 */
export async function requestOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host");
  const scheme = list.get("x-forwarded-proto") ?? "http";
  return `${scheme}://${host}`;
}
