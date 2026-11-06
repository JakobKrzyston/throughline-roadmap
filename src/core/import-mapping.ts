/** The review metadata a paired roadmap import keeps beside its operations, and how a reviewer's mapping choices turn into operations. Exports importMappingSchema, mappingDecisionsSchema, resolveImportMapping, leftOutReasonSchema, LEFT_OUT_REASONS and their types. */
import { z } from "zod";

import {
  createRequirementSchema,
  type GraphOperation,
  type GraphOperationInput,
} from "./operations";

const key = z.string().trim().min(1);
// References such as "P3" and "T14" to the records of the roadmaps an item came from.
const records = z.array(z.string()).min(1);

export const leftOutReasonSchema = z.enum([
  "wont_do",
  "cancelled",
  "duplicate",
  "already_shipped",
  "not_work",
]);

export type LeftOutReason = z.infer<typeof leftOutReasonSchema>;

/** Plain names for why a record was left out, for the review queue and the rationale. */
export const LEFT_OUT_REASONS: Record<LeftOutReason, string> = {
  wont_do: "won't do",
  cancelled: "cancelled",
  duplicate: "duplicate",
  already_shipped: "already shipped",
  not_work: "not planned work",
};

/**
 * What a paired import proposal knows about where each item came from and how sure the link is.
 * It is review metadata, not graph operations: approving writes only the operations.
 */
export const importMappingSchema = z.object({
  /** The text of every cited record, by reference, so the review can show each item's source rows. */
  records: z.record(z.string(), z.string()),
  outcomes: z.array(z.object({ key, records })),
  /** One entry per `create_requirement` the import proposes. */
  requirements: z.array(
    z.object({
      key,
      records,
      confidence: z.enum(["high", "low"]),
      reason: z.string(),
    }),
  ),
  /** Technical items that deliver no outcome, waiting for a reviewer to place them or leave them out. */
  unplaced: z.array(
    z.object({
      requirement: createRequirementSchema.omit({
        type: true,
        outcome_key: true,
      }),
      records,
      reason: z.string(),
      suggested_outcome_key: key.nullable(),
    }),
  ),
  left_out: z.array(
    z.object({ records, title: z.string(), reason: leftOutReasonSchema }),
  ),
});

export type ImportMapping = z.output<typeof importMappingSchema>;
export type ImportMappingInput = z.input<typeof importMappingSchema>;

/** A reviewer's mapping choices, as the review form sends them. */
export const mappingDecisionsSchema = z.object({
  /** Requirement key to the outcome key it moves to. */
  moves: z.record(key, key).default({}),
  /** Unplaced requirement key to the outcome key it goes under, or null to leave it out. */
  placements: z.record(key, key.nullable()).default({}),
});

export type MappingDecisions = z.input<typeof mappingDecisionsSchema>;

/**
 * Apply a reviewer's mapping choices to a paired import's operations.
 *
 * Moving a requirement changes its `outcome_key`, and placing an unplaced item adds its
 * `create_requirement` at the end, after every outcome the proposal creates. Whether the chosen
 * outcomes exist is left to applyProposal, which checks it against the graph.
 *
 * Args:
 *   operations: The proposal's validated operations, after any edits.
 *   mapping: The proposal's import mapping.
 *   decisions: The reviewer's moves and placements.
 *
 * Returns:
 *   The operations to apply, or why the choices cannot be applied: a choice names something
 *   that is not in the proposal, or an unplaced item has no decision yet.
 */
export function resolveImportMapping(
  operations: GraphOperation[],
  mapping: ImportMapping,
  decisions: z.output<typeof mappingDecisionsSchema>,
):
  | { ok: true; operations: GraphOperationInput[] }
  | { ok: false; message: string } {
  const requirementKeys = new Set(
    operations.flatMap((op) =>
      op.type === "create_requirement" ? [op.key] : [],
    ),
  );
  const unknownMove = Object.keys(decisions.moves).find(
    (requirementKey) => !requirementKeys.has(requirementKey),
  );
  if (unknownMove) {
    return {
      ok: false,
      message: `${unknownMove} is not a requirement this proposal creates`,
    };
  }
  const unplacedKeys = new Set(
    mapping.unplaced.map((item) => item.requirement.key),
  );
  const unknownPlacement = Object.keys(decisions.placements).find(
    (requirementKey) => !unplacedKeys.has(requirementKey),
  );
  if (unknownPlacement) {
    return {
      ok: false,
      message: `${unknownPlacement} is not waiting to be placed`,
    };
  }
  const undecided = mapping.unplaced.filter(
    (item) => decisions.placements[item.requirement.key] === undefined,
  );
  if (undecided.length > 0) {
    const titles = undecided.map((item) => `"${item.requirement.title}"`);
    return {
      ok: false,
      message: `Place or leave out ${titles.join(", ")} before approving`,
    };
  }

  const moved = operations.map((op) =>
    op.type === "create_requirement" && decisions.moves[op.key]
      ? { ...op, outcome_key: decisions.moves[op.key] }
      : op,
  );
  const placed = mapping.unplaced.flatMap((item) => {
    const outcomeKey = decisions.placements[item.requirement.key];
    return outcomeKey
      ? [
          {
            ...item.requirement,
            type: "create_requirement" as const,
            outcome_key: outcomeKey,
          },
        ]
      : [];
  });
  return { ok: true, operations: [...moved, ...placed] };
}
