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
    command: `pnpm db:migrate && pnpm db:seed && pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    // A separate PGlite database, so the tests never touch ./.pglite or a DATABASE_URL in .env.local.
    env: { DATABASE_URL: "", PGLITE_DATA_DIR: ".pglite-e2e" },
  },
});
