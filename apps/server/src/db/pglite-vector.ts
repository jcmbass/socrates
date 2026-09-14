/**
 * Shared PGlite + pgvector bootstrap for tests.
 *
 * Neon has `vector` 0.8.1. In-process tests use `@electric-sql/pglite-pgvector`
 * so `CREATE EXTENSION vector` and `vector(N)` columns work the same way.
 * Without this, schema-drift / migrate against pglite fail as soon as F2's
 * migration lands (plan-modal-rag 03 §5).
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

export function createPgliteWithVector(): PGlite {
  return new PGlite({
    extensions: { vector },
  });
}
