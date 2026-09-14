ALTER TABLE "usage_quotas" ALTER COLUMN "cost_usd_estimate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_quotas" ADD COLUMN "cost_usd_incomplete" boolean DEFAULT false NOT NULL;
