/** Zod schemas for the typed graph operations a proposal carries. Exports graphOperationSchema, operationListSchema, leafStatusSchema, workTypeSchema, WORK_TYPE_LABELS and their types. */
import { z } from "zod";

import { targetSchema } from "./schedule";

// Operations refer to outcomes and requirements by key (e.g. OUT-3, TL-12), not id,
// so one proposal can create an outcome and then add requirements under it.
const key = z.string().trim().min(1);
const text = z.string().trim().min(1);

export const leafStatusSchema = z.enum([
  "planned",
  "in_progress",
  "done",
  "dropped",
]);

export const workTypeSchema = z.enum([
  "feature",
  "infrastructure",
  "security",
  "tech_debt",
  "research",
]);

// Free text, so each project names its own teams. Null clears it, so the requirement inherits.
const team = z.string().trim().min(1).max(60);

const createOutcome = z.object({
  type: z.literal("create_outcome"),
  key,
  title: text,
  description: z.string().default(""),
  target: targetSchema.nullish(),
  priority: z.number().int().default(0),
});

// An update must change something; an empty one would write an event for nothing.
const nothingToChange = { message: "Update changes nothing" };

const updateOutcome = z
  .object({
    type: z.literal("update_outcome"),
    outcome_key: key,
    title: text.optional(),
    description: z.string().optional(),
    target: targetSchema.nullish(),
    priority: z.number().int().optional(),
    // Becomes the event's note only: outcomes have no product note of their own.
    product_note: z.string().nullish(),
  })
  .refine(
    (op) =>
      [op.title, op.description, op.target, op.priority].some(
        (value) => value !== undefined,
      ),
    nothingToChange,
  );

const createRequirement = z.object({
  type: z.literal("create_requirement"),
  key,
  outcome_key: key,
  title: text,
  description: z.string().default(""),
  user_visible: z.boolean().default(false),
  product_note: z.string().nullish(),
  target: targetSchema.nullish(),
  work_type: workTypeSchema.nullish(),
  team: team.nullish(),
});

// Children get no team of their own, so they inherit the parent's.
const splitChild = z.object({
  key,
  title: text,
  description: z.string().default(""),
  user_visible: z.boolean().default(false),
  status: leafStatusSchema.default("planned"),
  work_type: workTypeSchema.nullish(),
});

const splitRequirement = z.object({
  type: z.literal("split_requirement"),
  requirement_key: key,
  split_reason: text,
  product_note: text,
  children: z.array(splitChild).min(1),
});

const updateRequirement = z
  .object({
    type: z.literal("update_requirement"),
    requirement_key: key,
    title: text.optional(),
    description: z.string().optional(),
    user_visible: z.boolean().optional(),
    product_note: z.string().nullish(),
    target: targetSchema.nullish(),
    work_type: workTypeSchema.nullish(),
    team: team.nullish(),
  })
  .refine(
    (op) =>
      [
        op.title,
        op.description,
        op.user_visible,
        op.product_note,
        op.target,
        op.work_type,
        op.team,
      ].some((value) => value !== undefined),
    nothingToChange,
  );

const setStatus = z.object({
  type: z.literal("set_status"),
  requirement_key: key,
  status: leafStatusSchema,
  product_note: z.string().nullish(),
});

const linkWorkItem = z.object({
  type: z.literal("link_work_item"),
  requirement_key: key,
  work_item_id: z.uuid(),
  relation: z.enum(["implements", "part_of"]).default("implements"),
  confidence: z.enum(["explicit", "suggested"]),
});

const unlinkWorkItem = z.object({
  type: z.literal("unlink_work_item"),
  requirement_key: key,
  work_item_id: z.uuid(),
});

// Feedback, like work items, is referenced by id: proposals never create it.
const linkFeedback = z.object({
  type: z.literal("link_feedback"),
  outcome_key: key,
  feedback_id: z.uuid(),
});

const unlinkFeedback = z.object({
  type: z.literal("unlink_feedback"),
  outcome_key: key,
  feedback_id: z.uuid(),
});

/** One graph change. The `type` field selects the shape. */
export const graphOperationSchema = z.discriminatedUnion("type", [
  createOutcome,
  updateOutcome,
  createRequirement,
  splitRequirement,
  updateRequirement,
  setStatus,
  linkWorkItem,
  unlinkWorkItem,
  linkFeedback,
  unlinkFeedback,
]);

/** The `operations` list stored on a proposal. */
export const operationListSchema = z.array(graphOperationSchema).min(1);

/** A validated graph operation, with defaults filled in. */
export type GraphOperation = z.output<typeof graphOperationSchema>;

/** A graph operation as written by an agent or a person, before defaults. */
export type GraphOperationInput = z.input<typeof graphOperationSchema>;

export type LeafStatus = z.infer<typeof leafStatusSchema>;

export type WorkType = z.infer<typeof workTypeSchema>;

/** Plain names for the kinds of work, for the review queue, plan page and technical view. */
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  feature: "Feature",
  infrastructure: "Infrastructure",
  security: "Security",
  tech_debt: "Tech debt",
  research: "Research",
};
