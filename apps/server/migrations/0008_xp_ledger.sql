CREATE TABLE "xp_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_id" text,
	"topic_id" text,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"assessment_ref" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xp_events_user_id_idx" ON "xp_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "xp_events_subject_id_idx" ON "xp_events" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "xp_events_user_subject_idx" ON "xp_events" USING btree ("user_id","subject_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION xp_total(p_user_id text, p_subject_id text DEFAULT NULL)
RETURNS integer AS $$
DECLARE
  total integer;
BEGIN
  SELECT COALESCE(SUM(delta), 0)::integer INTO total
  FROM xp_events
  WHERE user_id = p_user_id
    AND (p_subject_id IS NULL OR subject_id = p_subject_id);
  RETURN total;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
