CREATE TABLE "fuentes" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"tokens" integer,
	"created_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuentes" ADD CONSTRAINT "fuentes_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuentes" ADD CONSTRAINT "fuentes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuentes_subject_id_idx" ON "fuentes" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "fuentes_user_id_idx" ON "fuentes" USING btree ("user_id");
