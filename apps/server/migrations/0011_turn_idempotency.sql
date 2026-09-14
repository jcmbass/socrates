CREATE TABLE "turn_claims" (
	"session_id" text NOT NULL,
	"client_message_id" text NOT NULL,
	"exchange_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "turn_claims_pkey" PRIMARY KEY("session_id","client_message_id")
);
--> statement-breakpoint
ALTER TABLE "turn_claims" ADD CONSTRAINT "turn_claims_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_claims" ADD CONSTRAINT "turn_claims_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "turn_claims_session_id_idx" ON "turn_claims" USING btree ("session_id");
