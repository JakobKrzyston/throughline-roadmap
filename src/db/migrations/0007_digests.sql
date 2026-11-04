ALTER TABLE "projects" ADD COLUMN "digest_slack_webhook_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "digest_sent_at" timestamp with time zone;