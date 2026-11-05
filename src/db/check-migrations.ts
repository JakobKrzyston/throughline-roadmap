/** CLI run by `pnpm build`: on a Vercel production build, fails if the database is missing a migration. Never migrates. */
import { createPostgresDb } from "./client";
import { pendingMigrations } from "./pending-migrations";

const MIGRATIONS_FOLDER = "src/db/migrations";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  // Previews, CI, local builds and builds without secrets are left exactly as they were.
  if (process.env.VERCEL_ENV !== "production" || !url) return;

  const db = createPostgresDb(url);
  try {
    const pending = await pendingMigrations(db, MIGRATIONS_FOLDER);
    if (pending.length === 0) {
      console.log("The production database has every migration applied.");
      return;
    }
    console.error(
      [
        `Build stopped: the production database is missing ${pending.length} migration(s) this commit needs:`,
        ...pending.map((tag) => `  ${MIGRATIONS_FOLDER}/${tag}.sql`),
        "The current production deployment keeps serving, and nothing was changed.",
        'Run `pnpm db:migrate` against production (docs/DEPLOY.md, "Migrate before you merge"), then redeploy.',
      ].join("\n"),
    );
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Could not check the production database's migrations:", error);
  process.exitCode = 1;
});
