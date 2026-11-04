ALTER TYPE "public"."proposal_source" ADD VALUE 'manual';--> statement-breakpoint
ALTER TYPE "public"."proposal_source" ADD VALUE 'reschedule';--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "target" text;