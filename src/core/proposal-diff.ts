/** Turns a proposal's operations into a readable diff against the current graph, for the review queue. Exports describeOperations, DiffEntry, GraphSnapshot. */
import {
  type GraphOperation,
  type LeafStatus,
  WORK_TYPE_LABELS,
  type WorkType,
} from "./operations";

/** One field an operation sets. `before` is absent for something new, and null when the field was empty. */
export type DiffChange = {
  field: string;
  before?: string | null;
  after: string | null;
};

/** One operation, as a heading and the fields it sets. */
export type DiffEntry = { heading: string; changes: DiffChange[] };

/** The parts of the current graph the diff needs, looked up by key (outcomes, requirements) or id (work items, feedback). */
export type GraphSnapshot = {
  outcomes: Map<
    string,
    {
      title: string;
      description: string;
      target: string | null;
      priority: number;
    }
  >;
  requirements: Map<
    string,
    {
      title: string;
      description: string;
      status: LeafStatus | null;
      userVisible: boolean;
      productNote: string | null;
      target: string | null;
      workType: WorkType | null;
      /** The requirement's own team, not one it inherits. */
      team: string | null;
    }
  >;
  workItems: Map<string, { title: string; kind: "issue" | "pull_request" }>;
  feedback: Map<string, { title: string }>;
};

const STATUS_LABELS: Record<LeafStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

const workTypeLabel = (
  type: WorkType | null | undefined,
): string | null | undefined => (type ? WORK_TYPE_LABELS[type] : type);

/**
 * Describe each operation as a heading plus the fields it changes, with current values where they exist.
 *
 * Args:
 *   operations: The proposal's validated operations.
 *   graph: The current graph. Keys created earlier in the same proposal are simply not found.
 *
 * Returns:
 *   One entry per operation, in order.
 */
export function describeOperations(
  operations: GraphOperation[],
  graph: GraphSnapshot,
): DiffEntry[] {
  return operations.map((op) => {
    switch (op.type) {
      case "create_outcome":
        return {
          heading: `New outcome ${op.key}: ${op.title}`,
          changes: [
            { field: "Description", after: op.description || null },
            { field: "Target", after: op.target ?? null },
            { field: "Priority", after: String(op.priority) },
          ],
        };

      case "update_outcome": {
        const current = graph.outcomes.get(op.outcome_key);
        return {
          heading: `Update outcome ${named(op.outcome_key, current)}`,
          changes: [
            change("Title", current?.title, op.title),
            change("Description", current?.description, op.description),
            change("Target", current?.target, op.target),
            change("Priority", current?.priority, op.priority),
            // Outcomes keep no note of their own; it only goes on the change feed.
            ...(op.product_note
              ? [{ field: "Product note", after: op.product_note }]
              : []),
          ].filter((c) => c !== null),
        };
      }

      case "create_requirement":
        return {
          heading: `New requirement ${op.key} under ${op.outcome_key}: ${op.title}`,
          changes: [
            { field: "Description", after: op.description || null },
            { field: "Visible to customers", after: yesNo(op.user_visible) },
            { field: "Product note", after: op.product_note ?? null },
            ...(op.target ? [{ field: "Target", after: op.target }] : []),
            ...(op.work_type
              ? [
                  {
                    field: "Kind of work",
                    after: WORK_TYPE_LABELS[op.work_type],
                  },
                ]
              : []),
            ...(op.team ? [{ field: "Team", after: op.team }] : []),
          ],
        };

      case "split_requirement": {
        const current = graph.requirements.get(op.requirement_key);
        return {
          heading: `Split ${named(op.requirement_key, current)} into ${op.children.length} pieces`,
          changes: [
            {
              field: "Status",
              before: current?.status ? STATUS_LABELS[current.status] : null,
              after: "Worked out from its pieces",
            },
            { field: "Why", after: op.split_reason },
            { field: "Product note", after: op.product_note },
            ...op.children.map((child) => ({
              field: `New piece ${child.key}`,
              after: `${child.title} (${[
                STATUS_LABELS[child.status],
                child.work_type && WORK_TYPE_LABELS[child.work_type],
                child.user_visible && "visible to customers",
              ]
                .filter(Boolean)
                .join(", ")})`,
            })),
          ],
        };
      }

      case "update_requirement": {
        const current = graph.requirements.get(op.requirement_key);
        return {
          heading: `Update ${named(op.requirement_key, current)}`,
          changes: [
            change("Title", current?.title, op.title),
            change("Description", current?.description, op.description),
            change(
              "Visible to customers",
              current && yesNo(current.userVisible),
              op.user_visible === undefined
                ? undefined
                : yesNo(op.user_visible),
            ),
            change("Product note", current?.productNote, op.product_note),
            change("Target", current?.target, op.target),
            change(
              "Kind of work",
              workTypeLabel(current?.workType),
              workTypeLabel(op.work_type),
            ),
            change("Team", current?.team, op.team),
          ].filter((c) => c !== null),
        };
      }

      case "set_status": {
        const current = graph.requirements.get(op.requirement_key);
        return {
          heading: `Change the status of ${named(op.requirement_key, current)}`,
          changes: [
            {
              field: "Status",
              before: current?.status ? STATUS_LABELS[current.status] : null,
              after: STATUS_LABELS[op.status],
            },
            ...(op.product_note
              ? [{ field: "Product note", after: op.product_note }]
              : []),
          ],
        };
      }

      case "link_work_item":
      case "unlink_work_item": {
        const requirement = graph.requirements.get(op.requirement_key);
        const item = graph.workItems.get(op.work_item_id);
        const itemName = item
          ? `${item.kind === "pull_request" ? "pull request" : "issue"} "${item.title}"`
          : "a work item";
        return op.type === "link_work_item"
          ? {
              heading: `Link ${itemName} to ${named(op.requirement_key, requirement)}`,
              changes: [
                {
                  field: "Relation",
                  after:
                    op.relation === "implements"
                      ? "Implements it"
                      : "Part of it",
                },
              ],
            }
          : {
              heading: `Unlink ${itemName} from ${named(op.requirement_key, requirement)}`,
              changes: [],
            };
      }

      case "link_feedback":
      case "unlink_feedback": {
        const outcome = graph.outcomes.get(op.outcome_key);
        const item = graph.feedback.get(op.feedback_id);
        const itemName = item ? `feedback "${item.title}"` : "feedback";
        return {
          heading:
            op.type === "link_feedback"
              ? `Link ${itemName} to outcome ${named(op.outcome_key, outcome)}`
              : `Unlink ${itemName} from outcome ${named(op.outcome_key, outcome)}`,
          changes: [],
        };
      }
    }
  });
}

function named(key: string, current: { title: string } | undefined): string {
  return current ? `${key}: ${current.title}` : key;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

/** A before/after row for a field an update sets, or null when the update leaves it alone. */
function change(
  field: string,
  before: string | number | null | undefined,
  after: string | number | null | undefined,
): DiffChange | null {
  if (after === undefined) return null;
  return {
    field,
    before: before == null || before === "" ? null : String(before),
    after: after === null || after === "" ? null : String(after),
  };
}
