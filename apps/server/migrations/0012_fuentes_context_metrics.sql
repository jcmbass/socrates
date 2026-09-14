-- plan-modal-rag F0.1 — durable truncation metrics (additive only).
-- Reviewed by hand: CREATE TABLE + FKs + analysis index. No ALTER on existing tables.
CREATE TABLE "fuentes_context_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"subject_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"builder" text NOT NULL,
	"fuente_count" integer NOT NULL,
	"corpus_tokens" integer NOT NULL,
	"truncated" boolean NOT NULL,
	"dropped_tokens" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuentes_context_metrics" ADD CONSTRAINT "fuentes_context_metrics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuentes_context_metrics" ADD CONSTRAINT "fuentes_context_metrics_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuentes_context_metrics_subject_created_idx" ON "fuentes_context_metrics" USING btree ("subject_id","created_at");
