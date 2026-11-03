/** CLI entry for `pnpm db:seed`: (re)creates the demo project in the app's database. */
import { loadEnvConfig } from "@next/env";

import { getDb } from "./client";
import { DEMO_SLUG, seedDemoProject } from "./seed";

// getDb reads DATABASE_URL when first called, so loading .env files here is early enough.
loadEnvConfig(process.cwd());

seedDemoProject(getDb()).then(() => {
  console.log(`Seeded demo project "${DEMO_SLUG}".`);
  // The database clients keep connections open; exit once the seed is written.
  process.exit(0);
});
