CREATE TABLE "topic_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topic_items" ADD CONSTRAINT "topic_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_items" ADD CONSTRAINT "topic_items_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "topic_items_subject_id_topic_id_unique" ON "topic_items" USING btree ("subject_id","topic_id");--> statement-breakpoint
CREATE INDEX "topic_items_user_id_idx" ON "topic_items" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "xp_events" ALTER COLUMN "assessment_ref" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "xp_events" ADD COLUMN "item_id" text;--> statement-breakpoint
ALTER TABLE "xp_events" ADD COLUMN "item_type" text;--> statement-breakpoint
ALTER TABLE "xp_events" ADD COLUMN "difficulty" integer;--> statement-breakpoint
ALTER TABLE "xp_events" ADD COLUMN "correct" boolean;--> statement-breakpoint
ALTER TABLE "xp_events" ADD COLUMN "response_ms" integer;--> statement-breakpoint
ALTER TABLE "xp_events" ADD COLUMN "attempt" integer;
