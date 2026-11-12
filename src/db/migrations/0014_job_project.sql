ALTER TABLE "jobs" ADD COLUMN "project_id" uuid;--> statement-breakpoint
-- Jobs queued before this migration name their project only through their payload.
UPDATE "jobs" SET "project_id" = "repositories"."project_id" FROM "repositories"
  WHERE "jobs"."type" = 'backfill' AND "repositories"."id" = ("jobs"."payload"->>'repositoryId')::uuid;--> statement-breakpoint
UPDATE "jobs" SET "project_id" = "work_items"."project_id" FROM "work_items"
  WHERE "jobs"."type" IN ('reconcile', 'link_suggest') AND "work_items"."id" = ("jobs"."payload"->>'workItemId')::uuid;--> statement-breakpoint
UPDATE "jobs" SET "project_id" = "outcomes"."project_id" FROM "outcomes"
  WHERE "jobs"."type" = 'slip_check' AND "outcomes"."id" = ("jobs"."payload"->>'outcomeId')::uuid;--> statement-breakpoint
UPDATE "jobs" SET "project_id" = "feedback"."project_id" FROM "feedback"
  WHERE "jobs"."type" = 'feedback_match' AND "feedback"."id" = ("jobs"."payload"->>'feedbackId')::uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
