/**
 * Test-only DB factory — pglite (in-memory WASM Postgres), migrated with the
 * exact same SQL files `db:migrate` applies to real Postgres. No Docker, no
 * external services, per the task's hard rule ("Tests contra Postgres
 * efímero local (docker) o pglite" — 04-plan-f1.md Ola 4 — pglite chosen).
 *
 * The pglite-backed `PgliteDatabase` and the prod `NodePgDatabase` both
 * extend the same `PgDatabase` base and expose an identical query-builder
 * surface at runtime; the cast below is the one place that bridges the two
 * driver-specific generic types so every repository can be written against
 * the single `Db` type from `./client`.
 */
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql, getTableName } from "drizzle-orm";
import { schema } from "./schema";
import type { Db } from "./client";
import { createPgliteWithVector } from "./pglite-vector";

export interface TestDb {
  db: Db;
  close: () => Promise<void>;
  /** Truncates every table (FK-safe via CASCADE) — call between tests that share one TestDb for speed. */
  reset: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  // pgvector required once migration 0013 lands (fuente_chunks.embedding).
  const client = createPgliteWithVector();
  const db = drizzle(client, { schema }) as unknown as Db;

  await migrate(db, { migrationsFolder: new URL("../../migrations", import.meta.url).pathname });

  return {
    db,
    close: () => client.close(),
    reset: async () => {
      for (const table of Object.values(schema)) {
        await db.execute(sql`TRUNCATE TABLE ${sql.identifier(getTableName(table))} CASCADE`);
      }
    },
  };
}
