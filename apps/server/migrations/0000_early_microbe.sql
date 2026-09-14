CREATE TABLE "assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"exchange_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"timestamp" text NOT NULL,
	"demonstrated_understanding" text NOT NULL,
	"explained_in_own_words" boolean NOT NULL,
	"guessed_or_pattern_matched" boolean NOT NULL,
	"recommended_band" text NOT NULL,
	"rationale" text NOT NULL,
	"topic_key" text,
	"assessor_prompt_version" text NOT NULL,
	"assessor_model_id" text NOT NULL,
	"assessor_provider_id" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"policy_version" text NOT NULL,
	"occurred_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"grade_level_id" text NOT NULL,
	"custom_label" text,
	"academic_year" integer,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchanges" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"index" integer NOT NULL,
	"timestamp" text NOT NULL,
	"student_message" text NOT NULL,
	"tutor_reply" text NOT NULL,
	"band" text NOT NULL,
	"tutor_prompt_version" text NOT NULL,
	"tutor_model_id" text NOT NULL,
	"tutor_provider_id" text NOT NULL,
	"hint_offered" boolean,
	"student_correct" boolean,
	"judge_prompt_version" text,
	"judge_model_id" text,
	"judge_provider_id" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "exchanges_session_index_unique" UNIQUE("session_id","index")
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" text,
	"payload" jsonb,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	CONSTRAINT "magic_link_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "material_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"original_filename" text,
	"created_at" text NOT NULL,
	"status" text NOT NULL,
	"storage" jsonb NOT NULL,
	"digested_text_ref" text NOT NULL,
	"token_count" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"dropped_tokens" integer DEFAULT 0 NOT NULL,
	"processing_report" jsonb NOT NULL,
	"digestion_pipeline_version" text NOT NULL,
	"removed_at" text,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exchange_id" text,
	"category" text NOT NULL,
	"detected_at" text NOT NULL,
	"classifier_provider_id" text NOT NULL,
	"classifier_model_id" text NOT NULL,
	"reviewed_at" text,
	"reviewed_by" text,
	"review_notes" text,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_name_snapshot" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"status" text NOT NULL,
	"initial_band" text NOT NULL,
	"material_asset_ids" jsonb NOT NULL,
	"material_snapshot_text_ref" text,
	"material_snapshot_info" jsonb,
	"band_changes" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"course_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_quotas" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"period_key" text NOT NULL,
	"tutor_messages_used" integer DEFAULT 0 NOT NULL,
	"assessor_calls_used" integer DEFAULT 0 NOT NULL,
	"judge_calls_used" integer DEFAULT 0 NOT NULL,
	"ingest_cloud_calls_used" integer DEFAULT 0 NOT NULL,
	"cost_usd_estimate" real DEFAULT 0 NOT NULL,
	"cap_tutor_messages" integer,
	"cap_cost_usd" real,
	"reset_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "usage_quotas_user_period_key_unique" UNIQUE("user_id","period","period_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"display_name" text NOT NULL,
	"auth_identifiers" jsonb NOT NULL,
	"primary_email" text NOT NULL,
	"country_code" text NOT NULL,
	"preferred_language_code" text NOT NULL,
	"age_confirmed_at" text NOT NULL,
	"birth_year" integer,
	"current_course_id" text,
	"account_status" text NOT NULL,
	"deleted_at" text,
	"account_kind" text NOT NULL,
	CONSTRAINT "users_primary_email_unique" UNIQUE("primary_email")
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_assets" ADD CONSTRAINT "material_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_assets" ADD CONSTRAINT "material_assets_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_quotas" ADD CONSTRAINT "usage_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_session_id_idx" ON "assessments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "assessments_subject_id_idx" ON "assessments" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "consents_user_id_idx" ON "consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "courses_user_id_idx" ON "courses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "exchanges_session_id_idx" ON "exchanges" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_email_idx" ON "magic_link_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "material_assets_subject_id_idx" ON "material_assets" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "material_assets_user_id_idx" ON "material_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "safety_incidents_user_id_idx" ON "safety_incidents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "safety_incidents_category_idx" ON "safety_incidents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "study_sessions_user_id_idx" ON "study_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "study_sessions_subject_id_idx" ON "study_sessions" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "study_sessions_user_status_idx" ON "study_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "subjects_course_id_idx" ON "subjects" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "subjects_user_id_idx" ON "subjects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_quotas_user_id_idx" ON "usage_quotas" USING btree ("user_id");