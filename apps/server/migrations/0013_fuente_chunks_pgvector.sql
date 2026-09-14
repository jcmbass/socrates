-- plan-modal-rag F2 — pgvector + fuente_chunks (additive only).
-- CREATE EXTENSION must live in migrations/ (D8), never consola Neon.
-- Reviewed by hand: extension + CREATE TABLE + 2 FKs + unique + btree + HNSW.
-- No ALTER on existing tables.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "fuente_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"fuente_id" text NOT NULL,
	"fuente_name" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"model_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuente_chunks" ADD CONSTRAINT "fuente_chunks_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuente_chunks" ADD CONSTRAINT "fuente_chunks_fuente_id_fuentes_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuente_chunks_fuente_id_chunk_index_unique" ON "fuente_chunks" USING btree ("fuente_id","chunk_index");--> statement-breakpoint
CREATE INDEX "fuente_chunks_subject_id_idx" ON "fuente_chunks" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "fuente_chunks_embedding_hnsw_idx" ON "fuente_chunks" USING hnsw ("embedding" vector_cosine_ops);
