ALTER TYPE "public"."work_item_source" ADD VALUE 'linear';--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "references_ignored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "identifier" text;