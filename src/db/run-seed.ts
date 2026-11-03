/** CLI entry for `pnpm db:seed`: (re)creates the demo project in the app's database. */
import { loadEnvConfig } from "@next/env";

import { createPgliteDb, createPostgresDb, localDataDir } from "./client";
import { DEMO_SLUG, seedDemoProject } from "./seed";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const url = process.env.DATABASE_URL;
  // Built here rather than with getDb so the script can close its own client.
  const db = url ? createPostgresDb(url) : createPgliteDb(localDataDir());
  try {
    await seedDemoProject(db);
    console.log(`Seeded demo project "${DEMO_SLUG}".`);
  } finally {
    // Closing PGlite cleanly flushes ./.pglite; killing the process can leave it needing recovery.
    const client = db.$client;
    await ("end" in client ? client.end() : client.close());
  }
}

main().catch((error: unknown) => {
  console.error("Seeding failed:", error);
  process.exitCode = 1;
});
