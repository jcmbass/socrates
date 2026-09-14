CREATE TABLE "temarios" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"user_id" text NOT NULL,
	"generated_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temas" (
	"id" text PRIMARY KEY NOT NULL,
	"temario_id" text NOT NULL,
	"order" integer NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hitos" (
	"id" text PRIMARY KEY NOT NULL,
	"temario_id" text NOT NULL,
	"order" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"covers_up_to_order" integer NOT NULL,
	"status" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "temarios" ADD CONSTRAINT "temarios_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temarios" ADD CONSTRAINT "temarios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temas" ADD CONSTRAINT "temas_temario_id_temarios_id_fk" FOREIGN KEY ("temario_id") REFERENCES "public"."temarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitos" ADD CONSTRAINT "hitos_temario_id_temarios_id_fk" FOREIGN KEY ("temario_id") REFERENCES "public"."temarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "temarios_subject_id_unique" ON "temarios" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "temarios_user_id_idx" ON "temarios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "temas_temario_id_idx" ON "temas" USING btree ("temario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "temas_temario_id_order_unique" ON "temas" USING btree ("temario_id","order");--> statement-breakpoint
CREATE INDEX "hitos_temario_id_idx" ON "hitos" USING btree ("temario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hitos_temario_id_order_unique" ON "hitos" USING btree ("temario_id","order");
