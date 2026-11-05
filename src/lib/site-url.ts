/** The site's public base URL, for metadata, robots.txt and the sitemap. Exports SITE_URL. */

// On Vercel this is the production domain, so previews never advertise themselves to search engines.
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";
