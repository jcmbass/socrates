CREATE TABLE "streaks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"longest" integer DEFAULT 0 NOT NULL,
	"last_qualifying_assessment_id" text,
	"last_qualifying_at" text,
	"updated_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" jsonb NOT NULL,
	"title_key" text NOT NULL,
	"description_key" text NOT NULL,
	"version" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"challenge_definition_id" text NOT NULL,
	"challenge_definition_version" text NOT NULL,
	"subject_id" text NOT NULL,
	"topic_key" text,
	"earned_at" text NOT NULL,
	"status" text NOT NULL,
	"revoked_at" text,
	"revoked_reason" text,
	"evidence_assessment_ids" jsonb NOT NULL,
	"retry_of" text,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_challenge_definition_id_challenge_definitions_id_fk" FOREIGN KEY ("challenge_definition_id") REFERENCES "public"."challenge_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "streaks_user_kind_unique" ON "streaks" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "streaks_user_id_idx" ON "streaks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "achievements_user_id_idx" ON "achievements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "achievements_subject_id_idx" ON "achievements" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "achievements_user_subject_idx" ON "achievements" USING btree ("user_id","subject_id");
