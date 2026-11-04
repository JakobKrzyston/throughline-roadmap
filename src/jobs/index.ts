/** Runs the app's queued jobs with their real handlers. Exports runQueuedJobs. */
import { eq } from "drizzle-orm";

import { getGitHubAdapter, isGitHubConfigured } from "@/adapters/github";
import { getDemoLLMProvider, getLLMProvider } from "@/adapters/llm";
import type { LLMProvider } from "@/adapters/llm/provider";
import type { SourceAdapter } from "@/adapters/source";
import { DEMO_LLM_FIXTURES } from "@/agents/fixtures";
import { runLinkSuggest } from "@/agents/link-suggest";
import { runReconcile } from "@/agents/reconcile";
import { runSlipCheck } from "@/agents/slip";
import { getDb } from "@/db/client";
import { outcomes, projects, workItems } from "@/db/schema";

import { runBackfill } from "./backfill";
import { runJobs } from "./queue";

/**
 * Run due jobs against the app database.
 *
 * Without GitHub credentials the agents still run, on the work item's title and description alone.
 * Agents for demo projects use the demo provider (a free OpenRouter model, else sample results)
 * and skip GitHub, wherever the job runs: on a public site visitors queue these jobs and must not
 * spend the Anthropic key, and the demo's repository is made up.
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

  async function agentsFor(
    workItemId: string,
  ): Promise<{ llm: LLMProvider; source: SourceAdapter | null }> {
    const [row] = await db
      .select({ isDemo: projects.isDemo })
      .from(workItems)
      .innerJoin(projects, eq(workItems.projectId, projects.id))
      .where(eq(workItems.id, workItemId));
    if (row?.isDemo) {
      return { llm: getDemoLLMProvider(DEMO_LLM_FIXTURES), source: null };
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
    slip_check: async ({ outcomeId }) => {
      const [row] = await db
        .select({ isDemo: projects.isDemo })
        .from(outcomes)
        .innerJoin(projects, eq(outcomes.projectId, projects.id))
        .where(eq(outcomes.id, outcomeId));
      await runSlipCheck(
        db,
        row?.isDemo ? getDemoLLMProvider(DEMO_LLM_FIXTURES) : llm,
        outcomeId,
        new Date().toISOString().slice(0, 10),
      );
    },
  });
}
