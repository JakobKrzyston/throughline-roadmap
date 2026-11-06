/** Creates the empty project the import smoke tests import into, so their proposals never change the demo project other specs count. Exports nothing; run with tsx. */
import { eq } from "drizzle-orm";

import { createPgliteDb, localDataDir } from "@/db/client";
import { projects } from "@/db/schema";

/** The project tests/e2e/import.spec.ts uses. */
const SLUG = "import-e2e";

async function main(): Promise<void> {
  const db = createPgliteDb(localDataDir());
  try {
    // Start empty on every run; deleting the project removes its proposals too.
    await db.delete(projects).where(eq(projects.slug, SLUG));
    await db.insert(projects).values({ name: "Import tests", slug: SLUG });
  } finally {
    await db.$client.close();
  }
}

main().catch((error: unknown) => {
  console.error("Seeding the import test project failed:", error);
  process.exitCode = 1;
});
