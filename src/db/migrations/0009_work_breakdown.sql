CREATE TYPE "public"."work_type" AS ENUM('feature', 'infrastructure', 'security', 'tech_debt', 'research');--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "work_type" "work_type";--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "people" text[] DEFAULT '{}'::text[] NOT NULL;