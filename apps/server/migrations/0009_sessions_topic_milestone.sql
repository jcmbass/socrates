ALTER TABLE "study_sessions" ADD COLUMN "kind" text DEFAULT 'topic' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "milestone_id" text;--> statement-breakpoint
CREATE INDEX "study_sessions_topic_id_idx" ON "study_sessions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "study_sessions_milestone_id_idx" ON "study_sessions" USING btree ("milestone_id");
