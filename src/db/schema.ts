/** Drizzle table definitions for the traceability graph, proposals, events and jobs. See docs/ARCHITECTURE.md. */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { GraphOperationInput } from "@/core/operations";

export const requirementStatus = pgEnum("requirement_status", [
  "planned",
  "in_progress",
  "done",
  "dropped",
]);
export const workItemSource = pgEnum("work_item_source", ["github"]);
export const workItemKind = pgEnum("work_item_kind", ["issue", "pull_request"]);
export const workItemState = pgEnum("work_item_state", [
  "open",
  "closed",
  "merged",
  // An issue closed without being done: GitHub's "not planned" or "duplicate".
  "not_planned",
]);
export const linkRelation = pgEnum("link_relation", ["implements", "part_of"]);
export const linkConfidence = pgEnum("link_confidence", [
  "explicit",
  "suggested",
]);
export const proposalSource = pgEnum("proposal_source", [
  "import",
  "reconcile",
  "link_suggest",
  // PR references like "Implements TL-12": approved automatically by the sync, never by a person.
  "explicit_link",
  // An open PR references a planned requirement, so work on it has started. Also automatic.
  "work_started",
]);
export const proposalStatus = pgEnum("proposal_status", [
  "pending",
  "approved",
  "rejected",
  "superseded",
]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "done",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isDemo: boolean("is_demo").notNull().default(false),
  // Slack incoming webhook the weekly digest goes to; null sends none. Never shown in full, since
  // anyone holding it can post to the channel.
  digestSlackWebhookUrl: text("digest_slack_webhook_url"),
  digestSentAt: timestamp("digest_sent_at", { withTimezone: true }),
  ...timestamps,
});

// Repositories connected to a project. Webhooks find their project through external_id,
// which survives renames, unlike the full name.
export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: workItemSource("source").notNull(),
    externalId: text("external_id").notNull(),
    fullName: text("full_name").notNull(),
    // When the newest release seen was published. A release digest covers the changes since then.
    lastReleaseAt: timestamp("last_release_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.source, t.externalId)],
);

export const outcomes = pgTable(
  "outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    target: text("target"),
    priority: integer("priority").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.key)],
);

export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    outcomeId: uuid("outcome_id").references(() => outcomes.id, {
      onDelete: "cascade",
    }),
    parentId: uuid("parent_id").references((): AnyPgColumn => requirements.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // Leaf requirements only; null on parents (rollups are computed in src/core/rollup.ts).
    status: requirementStatus("status"),
    userVisible: boolean("user_visible").notNull().default(false),
    productNote: text("product_note"),
    splitReason: text("split_reason"),
    ...timestamps,
  },
  (t) => [
    unique().on(t.projectId, t.key),
    check(
      "requirements_one_anchor",
      sql`(${t.outcomeId} is null) <> (${t.parentId} is null)`,
    ),
  ],
);

export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: workItemSource("source").notNull(),
    externalId: text("external_id").notNull(),
    kind: workItemKind("kind").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    state: workItemState("state").notNull(),
    bodyExcerpt: text("body_excerpt").notNull().default(""),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // When the source last changed the item. Null for items stored before this was recorded.
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.source, t.externalId)],
);

export const links = pgTable(
  "links",
  {
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    relation: linkRelation("relation").notNull(),
    confidence: linkConfidence("confidence").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.requirementId, t.workItemId] })],
);

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  source: proposalSource("source").notNull(),
  status: proposalStatus("status").notNull().default("pending"),
  summary: text("summary").notNull(),
  rationale: text("rationale").notNull().default(""),
  // Validated with operationListSchema when the proposal is applied.
  operations: jsonb("operations").$type<GraphOperationInput[]>().notNull(),
  triggerWorkItemId: uuid("trigger_work_item_id").references(
    () => workItems.id,
    { onDelete: "set null" },
  ),
  // The requirement a reconcile proposal is about. A newer one supersedes older pending ones.
  requirementId: uuid("requirement_id").references(() => requirements.id, {
    onDelete: "set null",
  }),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...timestamps,
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Insertion order. Events from one transaction share created_at, so order by this instead.
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  actor: text("actor").notNull(),
  proposalId: uuid("proposal_id").references(() => proposals.id, {
    onDelete: "set null",
  }),
  payload: jsonb("payload").notNull(),
  productNote: text("product_note"),
  ...timestamps,
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  status: jobStatus("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  runAfter: timestamp("run_after", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ...timestamps,
});
