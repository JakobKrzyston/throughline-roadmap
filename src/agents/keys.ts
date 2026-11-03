/** Numbers new outcome and requirement keys so agent proposals never clash with existing or pending ones. Exports lastKeyNumbers. */
import { and, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { outcomes, projects, proposals, requirements } from "@/db/schema";

/**
 * Lock the project and find the highest `OUT-n` and `TL-n` numbers in use.
 *
 * Counts keys in the graph and keys that pending proposals would create. Call it inside the
 * transaction that inserts the new proposal: the project row lock makes two agents running at
 * once wait for each other instead of picking the same keys.
 *
 * Args:
 *   tx: Transaction the new proposal will be written in.
 *   projectId: The project.
 *
 * Returns:
 *   The highest outcome and requirement numbers in use, 0 when there are none.
 */
export async function lastKeyNumbers(
  tx: Database,
  projectId: string,
): Promise<{ outcome: number; requirement: number }> {
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("update");
  // Pending proposals first, then the graph: a proposal approved in between has its keys in the
  // graph by the second read, so no key can slip between the two.
  const pending = await tx
    .select({ operations: proposals.operations })
    .from(proposals)
    .where(
      and(eq(proposals.projectId, projectId), eq(proposals.status, "pending")),
    );
  const outcomeRows = await tx
    .select({ key: outcomes.key })
    .from(outcomes)
    .where(eq(outcomes.projectId, projectId));
  const requirementRows = await tx
    .select({ key: requirements.key })
    .from(requirements)
    .where(eq(requirements.projectId, projectId));
  const proposed = pending.flatMap(({ operations }) =>
    operations.flatMap((op) => {
      if (op.type === "create_outcome" || op.type === "create_requirement") {
        return [op.key];
      }
      if (op.type === "split_requirement") {
        return op.children.map((child) => child.key);
      }
      return [];
    }),
  );
  const taken = [...outcomeRows, ...requirementRows]
    .map((row) => row.key)
    .concat(proposed);
  return {
    outcome: highestNumber(taken, "OUT"),
    requirement: highestNumber(taken, "TL"),
  };
}

function highestNumber(keys: string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  return Math.max(0, ...keys.map((key) => Number(pattern.exec(key)?.[1] ?? 0)));
}
