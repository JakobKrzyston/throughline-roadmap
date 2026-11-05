/** /sitemap.xml: the landing page and the demo project's read-only pages. */
import type { MetadataRoute } from "next";

import { DEMO_SLUG } from "@/db/seed";
import { SITE_URL } from "@/lib/site-url";

/**
 * The public pages worth indexing. Import and settings are forms, so they are left out.
 *
 * Returns:
 *   One entry per page.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const demo = `${SITE_URL}/p/${DEMO_SLUG}`;
  return [
    { url: SITE_URL },
    { url: demo },
    { url: `${demo}/tech` },
    { url: `${demo}/plan` },
    { url: `${demo}/feedback` },
    { url: `${demo}/review` },
  ];
}
