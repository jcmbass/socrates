ALTER TABLE "study_sessions" ADD COLUMN "previous_session_id" text;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD COLUMN "triggering_text" text;--> statement-breakpoint
CREATE TABLE "quota_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"surface" text NOT NULL,
	"rejected_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quota_rejections" ADD CONSTRAINT "quota_rejections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quota_rejections_user_id_idx" ON "quota_rejections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quota_rejections_rejected_at_idx" ON "quota_rejections" USING btree ("rejected_at");
