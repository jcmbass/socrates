CREATE TABLE "mastery_history_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"topic_key" text NOT NULL,
	"level" jsonb NOT NULL,
	"computed_at" text NOT NULL,
	"computed_by_version" text NOT NULL,
	"contributing_assessment_ids" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_states" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"topic_key" text NOT NULL,
	"current_level" jsonb NOT NULL,
	"visibility" text NOT NULL,
	"last_history_entry_id" text NOT NULL,
	"updated_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mastery_states_user_subject_topic_unique" UNIQUE("user_id","subject_id","topic_key")
);
--> statement-breakpoint
ALTER TABLE "mastery_history_entries" ADD CONSTRAINT "mastery_history_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_history_entries" ADD CONSTRAINT "mastery_history_entries_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_states" ADD CONSTRAINT "mastery_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_states" ADD CONSTRAINT "mastery_states_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_states" ADD CONSTRAINT "mastery_states_last_history_entry_id_mastery_history_entries_id_fk" FOREIGN KEY ("last_history_entry_id") REFERENCES "public"."mastery_history_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mastery_history_entries_user_subject_topic_idx" ON "mastery_history_entries" USING btree ("user_id","subject_id","topic_key");--> statement-breakpoint
CREATE INDEX "mastery_states_user_id_idx" ON "mastery_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mastery_states_subject_id_idx" ON "mastery_states" USING btree ("subject_id");