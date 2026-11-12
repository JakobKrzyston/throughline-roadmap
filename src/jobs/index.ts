/** Runs the app's queued jobs with their real handlers. Exports runQueuedJobs. */
import { eq } from "drizzle-orm";

import { getGitHubAdapter, isGitHubConfigured } from "@/adapters/github";
import { linearAdapterFor } from "@/adapters/linear";
import { getDemoLLMProvider, getLLMProvider } from "@/adapters/llm";
import type { LLMProvider } from "@/adapters/llm/provider";
import type { SourceAdapter } from "@/adapters/source";
import { runFeedbackMatch } from "@/agents/feedback-match";
import { DEMO_LLM_FIXTURES } from "@/agents/fixtures";
import { runLinkSuggest } from "@/agents/link-suggest";
import { runReconcile } from "@/agents/reconcile";
import { runSlipCheck } from "@/agents/slip";
import { getDb } from "@/db/client";
import { feedback, outcomes, projects, workItems } from "@/db/schema";
import { isPublicDeployment } from "@/lib/public-deployment";

import { runBackfill } from "./backfill";
import { runJobs } from "./queue";

/**
 * Run due jobs against the app database.
 *
 * A backfill reads from the source its repository came from, GitHub or Linear; a demo project's
 * Linear team is the sample one, so its backfill never calls Linear. Without GitHub credentials
 * the agents still run, on the work item's title and description alone, as they always do for
 * issues, including Linear's, which have no changed files. Agents for demo projects use the demo
 * provider (a free OpenRouter model, else sample results) and skip GitHub, wherever the job runs:
 * on a public site visitors queue these jobs and must not spend the Anthropic key, and the demo's
 * repository is made up.
 *
 * A public deployment runs only demo projects' jobs. Its other projects are view-only there, and
 * when it shares a database with a private instance, their jobs are the private instance's to run.
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

  return runJobs(
    db,
    {
      backfill: (payload) => runBackfill(db, backfillSource, payload),
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
      feedback_match: async ({ feedbackId }) => {
        const [row] = await db
          .select({ isDemo: projects.isDemo })
          .from(feedback)
          .innerJoin(projects, eq(feedback.projectId, projects.id))
          .where(eq(feedback.id, feedbackId));
        await runFeedbackMatch(
          db,
          row?.isDemo ? getDemoLLMProvider(DEMO_LLM_FIXTURES) : llm,
          { feedbackId },
        );
      },
    },
    { demoOnly: isPublicDeployment() },
  );
}

// The source a backfill reads its repository from.
function backfillSource(repository: {
  source: "github" | "linear";
  isDemo: boolean;
}): SourceAdapter {
  if (repository.source === "github") return getGitHubAdapter();
  const linear = linearAdapterFor(repository);
  if (!linear) {
    throw new Error(
      "Linear is not set up: set LINEAR_API_KEY (see docs/LINEAR.md)",
    );
  }
  return linear;
}
