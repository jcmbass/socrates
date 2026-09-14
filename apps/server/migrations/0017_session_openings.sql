CREATE TABLE "session_openings" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"text" text,
	"tutor_model_id" text,
	"tutor_provider_id" text,
	"tutor_prompt_version" text,
	"grounding" text,
	"status" text NOT NULL,
	"claimed_at" text NOT NULL,
	"created_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "session_openings_status_check" CHECK ("status" IN ('generating', 'ready')),
	CONSTRAINT "session_openings_grounding_check" CHECK ("grounding" IS NULL OR "grounding" IN ('fuentes', 'general')),
	CONSTRAINT "session_openings_ready_payload_check" CHECK (("status" = 'generating') OR ("status" = 'ready' AND "text" IS NOT NULL AND char_length("text") > 0 AND "tutor_model_id" IS NOT NULL AND "tutor_provider_id" IS NOT NULL AND "tutor_prompt_version" IS NOT NULL AND "grounding" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "session_openings" ADD CONSTRAINT "session_openings_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_openings" ADD CONSTRAINT "session_openings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_openings_session_id_unique" ON "session_openings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_openings_user_id_idx" ON "session_openings" USING btree ("user_id");
