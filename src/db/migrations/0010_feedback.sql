ALTER TYPE "public"."proposal_source" ADD VALUE 'feedback_match';--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" "work_item_source" NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"body_excerpt" text DEFAULT '' NOT NULL,
	"theme" text,
	"withdrawn" boolean DEFAULT false NOT NULL,
	"source_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_project_id_source_external_id_unique" UNIQUE("project_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "feedback_links" (
	"feedback_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_links_feedback_id_outcome_id_pk" PRIMARY KEY("feedback_id","outcome_id")
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "trigger_feedback_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_links" ADD CONSTRAINT "feedback_links_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_links" ADD CONSTRAINT "feedback_links_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_trigger_feedback_id_feedback_id_fk" FOREIGN KEY ("trigger_feedback_id") REFERENCES "public"."feedback"("id") ON DELETE set null ON UPDATE no action;