/** Tests for /api/digests/send against an in-memory database, with Slack stubbed. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projects } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));
const postToSlack = vi.hoisted(() => vi.fn(async () => {}));
vi.mock(import("@/adapters/slack"), async (importOriginal) => ({
  ...(await importOriginal()),
  postToSlack,
}));

const { GET } = await import("./route");

const SECRET = "cron-secret";
const WEBHOOK = "https://hooks.slack.com/services/T000/B000/abc123";

function send(authorization?: string): Promise<Response> {
  return GET(
    new Request("https://throughline.example/api/digests/send", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

beforeEach(async () => {
  vi.stubEnv("CRON_SECRET", SECRET);
  const db = await createTestDb();
  state.db = db;
  const projectId = await seedDemoProject(db);
  await db
    .update(projects)
    .set({ digestSlackWebhookUrl: WEBHOOK })
    .where(eq(projects.id, projectId));
  postToSlack.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/digests/send", () => {
  it("refuses a request without the cron secret and sends nothing", async () => {
    expect((await send()).status).toBe(401);
    expect((await send("Bearer wrong")).status).toBe(401);
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("stays shut when no cron secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");

    expect((await send("Bearer ")).status).toBe(401);
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("sends due digests, linking to the domain the cron called", async () => {
    const response = await send(`Bearer ${SECRET}`);

    expect(await response.json()).toEqual({ sent: 1, failed: 0 });
    expect(postToSlack).toHaveBeenCalledWith(
      WEBHOOK,
      expect.stringContaining(
        "The full roadmap: https://throughline.example/p/acme-analytics",
      ),
    );
  });
});
