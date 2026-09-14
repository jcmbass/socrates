/**
 * DB client construction — two drivers behind one `Db` type so every
 * repository/route module is driver-agnostic:
 *
 *  - `createPgDb(connectionString)`: real Postgres (`pg`/node-postgres) —
 *    used in dev/staging/prod (DF-6: Postgres administrado, host-agnostic).
 *  - `createPgliteDb()`: in-memory pglite (WASM Postgres, no external
 *    process) — used by the test suite exclusively. Zero external services,
 *    per the task's hard rule.
 *
 * Both `drizzle(...)` calls return structurally-compatible query builders
 * (`PgDatabase<*, typeof schema>` is the shared base both extend) — `Db` is
 * intentionally the `node-postgres` flavor with pglite's return value cast
 * across at the one call site that constructs it (db/test-db.ts), rather
 * than widening every repository's signature to a union type.
 */
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export function createPgDb(connectionString: string): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString });
  const db = drizzleNodePg(pool, { schema });
  return { db, pool };
}
