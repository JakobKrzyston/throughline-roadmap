/** /robots.txt: crawl the pages, not the API. */
import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-url";

/**
 * Robots rules for every crawler.
 *
 * Returns:
 *   The rules and the sitemap's address.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
