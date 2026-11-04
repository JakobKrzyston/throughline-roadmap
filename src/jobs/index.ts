/** Runs the app's queued jobs with their real handlers. Exports runQueuedJobs. */
import { eq } from "drizzle-orm";

import { getGitHubAdapter, isGitHubConfigured } from "@/adapters/github";
import { getLLMProvider } from "@/adapters/llm";
import { FakeLLMProvider } from "@/adapters/llm/fake";
import { DEMO_LLM_FIXTURES } from "@/agents/fixtures";
import { runLinkSuggest } from "@/agents/link-suggest";
import { runReconcile } from "@/agents/reconcile";
import { getDb } from "@/db/client";
import { projects, workItems } from "@/db/schema";
import { isPublicDeployment } from "@/lib/public-deployment";

import { runBackfill } from "./backfill";
import { runJobs } from "./queue";

/**
 * Run due jobs against the app database.
 *
 * Without GitHub credentials the agents still run, on the work item's title and description alone.
 * On a public deployment, agents for demo projects use sample results and skip GitHub, so
 * visitors cannot spend the AI key and the demo's made-up repository is never looked up.
 *
 * Returns:
 *   How many jobs finished and how many failed.
 */
export async function runQueuedJobs(): Promise<{
  done: number;
  failed: number;
}> {
  const db = getDb();
  const llm = getLLMProvider(DEMO_LLM_FIXTURES);
  const source = isGitHubConfigured() ? getGitHubAdapter() : null;

  async function agentsFor(workItemId: string) {
    if (isPublicDeployment()) {
      const [row] = await db
        .select({ isDemo: projects.isDemo })
        .from(workItems)
        .innerJoin(projects, eq(workItems.projectId, projects.id))
        .where(eq(workItems.id, workItemId));
      if (row?.isDemo) {
        return { llm: new FakeLLMProvider(DEMO_LLM_FIXTURES), source: null };
      }
    }
    return { llm, source };
  }

  return runJobs(db, {
    backfill: (payload) => runBackfill(db, getGitHubAdapter(), payload),
    reconcile: async (payload) => {
      const agents = await agentsFor(payload.workItemId);
      await runReconcile(db, agents.llm, agents.source, payload);
    },
    link_suggest: async (payload) => {
      const agents = await agentsFor(payload.workItemId);
      await runLinkSuggest(db, agents.llm, agents.source, payload);
    },
  });
}
