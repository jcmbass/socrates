/**
 * Prod/dev migration runner (`npm run db:migrate -w apps/server`). Applies
 * the SQL files under `migrations/` (generated via `drizzle-kit generate`
 * from `src/db/schema.ts`) against `DATABASE_URL`. The test suite applies
 * the SAME files against pglite (`src/db/test-db.ts`) — one source of
 * truth for schema DDL, never hand-duplicated SQL.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createPgDb } from "./client";
import { readEnv } from "../env";

async function main(): Promise<void> {
  const env = readEnv(process.env);
  const { db, pool } = createPgDb(env.DATABASE_URL);
  await migrate(db, { migrationsFolder: new URL("../../migrations", import.meta.url).pathname });
  await pool.end();
  console.log("[db:migrate] applied migrations successfully");
}

main().catch((err) => {
  console.error("[db:migrate] failed:", err);
  process.exit(1);
});
