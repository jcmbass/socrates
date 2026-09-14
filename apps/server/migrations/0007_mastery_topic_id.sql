ALTER TABLE "mastery_history_entries" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "mastery_states" ADD COLUMN "topic_id" text;--> statement-breakpoint
CREATE INDEX "mastery_history_entries_subject_topic_id_idx" ON "mastery_history_entries" USING btree ("subject_id","topic_id");--> statement-breakpoint
CREATE INDEX "mastery_states_subject_topic_id_idx" ON "mastery_states" USING btree ("subject_id","topic_id");
