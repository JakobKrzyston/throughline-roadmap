/** Runs the app's queued jobs with their real handlers. Exports runQueuedJobs. */
import { getGitHubAdapter, isGitHubConfigured } from "@/adapters/github";
import { getLLMProvider } from "@/adapters/llm";
import { DEMO_LLM_FIXTURES } from "@/agents/fixtures";
import { runLinkSuggest } from "@/agents/link-suggest";
import { runReconcile } from "@/agents/reconcile";
import { getDb } from "@/db/client";

import { runBackfill } from "./backfill";
import { runJobs } from "./queue";

/**
 * Run due jobs against the app database.
 *
 * Without GitHub credentials the agents still run, on the work item's title and description alone.
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
  return runJobs(db, {
    backfill: ({ repositoryId }) =>
      runBackfill(db, getGitHubAdapter(), repositoryId),
    reconcile: async (payload) => {
      await runReconcile(db, llm, source, payload);
    },
    link_suggest: async (payload) => {
      await runLinkSuggest(db, llm, source, payload);
    },
  });
}
