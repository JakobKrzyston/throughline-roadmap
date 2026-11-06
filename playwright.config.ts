/** Playwright config for the end-to-end smoke tests: builds the app and serves the demo project from its own database. */
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The import specs get a project of their own, so the demo's proposal counts stay as seeded.
    command: `pnpm db:migrate && pnpm db:seed && pnpm exec tsx tests/e2e/seed-import-project.ts && pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    // A separate PGlite database, so the tests never touch ./.pglite or a database URL in .env.local.
    env: {
      DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      PGLITE_DATA_DIR: ".pglite-e2e",
      // Imports must use the demo fixtures, never a model key from .env.local.
      ANTHROPIC_API_KEY: "",
      OPENROUTER_API_KEY: "",
      // The Linear import must read the sample workspace, never a real one.
      LINEAR_API_KEY: "",
      // The import and settings specs need a signed-in, editable app, not a view-only public one.
      PUBLIC_DEPLOYMENT: "",
    },
  },
});
