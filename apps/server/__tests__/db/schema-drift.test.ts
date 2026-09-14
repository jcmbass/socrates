/**
 * Guardia permanente contra el desvío entre `schema.ts` y `migrations/`.
 *
 * POR QUÉ EXISTE — 2026-07-30: los snapshots de drizzle estaban congelados en
 * `0002` porque las migraciones 0003–0011 se escribieron a mano sin actualizar
 * `meta/`. Consecuencia: `npm run db:generate` comparaba contra un estado de
 * diez migraciones atrás y **proponía recrear tablas que ya existían en
 * producción**. Nadie se enteró durante nueve migraciones, porque nada lo
 * comprobaba.
 *
 * Este archivo comprueba las dos mitades del contrato:
 *
 *  1. **El snapshot dice la verdad** ⇒ `db:generate` es confiable.
 *  2. **El SQL aplicado produce el esquema que el código declara** ⇒ nadie
 *     escribió una migración a mano que se desvíe de `schema.ts`.
 *
 * La segunda es la que importa de verdad: es la que atrapa "declaré una
 * restricción en el código y me olvidé de ponerla en el SQL".
 *
 * Todo corre en proceso (pglite + la API de `drizzle-kit`) — sin Docker, sin
 * red, sin lanzar la CLI.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { schema } from "../../src/db/schema";
import { createPgliteWithVector } from "../../src/db/pglite-vector";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

/** El snapshot de índice más alto — el que `drizzle-kit generate` usa como estado previo. */
function latestSnapshotPath(): string {
  const metaDir = join(MIGRATIONS_DIR, "meta");
  const snapshots = readdirSync(metaDir)
    .filter((f) => /^\d+_snapshot\.json$/.test(f))
    .sort();
  const last = snapshots[snapshots.length - 1];
  if (!last) throw new Error("migrations/meta/ no tiene ningún snapshot");
  return join(metaDir, last);
}

/**
 * Huella del esquema vivo: columnas, **tipos con modificador**, restricciones
 * e índices.
 *
 * Los índices NO son opcionales acá. El 2026-07-30 comparé solo
 * `table_constraints` y concluí que faltaban cuatro unicidades que en realidad
 * existían **como índices únicos** — reporté un problema de producción
 * inexistente. Un índice único impone unicidad igual que una restricción y vive
 * en otra tabla de metadatos.
 *
 * Los TIPOS tampoco. El 2026-07-30, al revisar F2, muté la migración de
 * `vector(384)` a `vector(256)` y **esta guardia no se enteró**:
 * `information_schema.columns.data_type` devuelve `USER-DEFINED` para pgvector
 * y **descarta el modificador**. La dimensión equivocada en Neon rompe cada
 * INSERT de embeddings, y se descubriría recién al cablear F3. `format_type`
 * sobre `pg_attribute` sí lo renderiza — y de paso cubre `varchar(n)`,
 * `numeric(p,s)` y cualquier otro modificador.
 */
async function fingerprint(apply: (db: ReturnType<typeof drizzle>) => Promise<void>): Promise<string> {
  // F2: migrations create `vector` columns. Plain PGlite has no pgvector —
  // load `@electric-sql/pglite-pgvector` so CREATE EXTENSION / vector(N) work.
  const client = createPgliteWithVector();
  const db = drizzle(client);
  try {
    await apply(db);
    const columns = await db.execute(sql`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> '__drizzle_migrations'
      ORDER BY table_name, column_name`);
    // Tipo REAL con modificador — `vector(384)`, no `USER-DEFINED`.
    const types = await db.execute(sql`
      SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS tipo
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND a.attnum > 0 AND NOT a.attisdropped
        AND c.relname <> '__drizzle_migrations'
      ORDER BY c.relname, a.attname`);
    const constraints = await db.execute(sql`
      SELECT tc.table_name, tc.constraint_type, kcu.column_name
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public' AND tc.table_name <> '__drizzle_migrations'
      ORDER BY tc.table_name, tc.constraint_type, kcu.column_name`);
    const indexes = await db.execute(sql`
      SELECT tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
      ORDER BY tablename, indexdef`);
    const render = (rows: unknown[]) =>
      (rows as Record<string, unknown>[]).map((r) => Object.values(r).join(" | ")).join("\n");
    return [
      "== COLUMNAS ==",
      render(columns.rows),
      "== TIPOS ==",
      render(types.rows),
      "== RESTRICCIONES ==",
      render(constraints.rows),
      "== ÍNDICES ==",
      render(indexes.rows),
    ].join("\n");
  } finally {
    await client.close();
  }
}

describe("desvío de esquema — migrations/ vs schema.ts", () => {
  it("el snapshot commiteado no tiene nada pendiente contra schema.ts (db:generate es confiable)", async () => {
    const fromSchema = generateDrizzleJson(schema as unknown as Record<string, unknown>);
    const committed = JSON.parse(readFileSync(latestSnapshotPath(), "utf8")) as Record<string, unknown>;
    const pending = await generateMigration(committed, fromSchema);

    // Si esto falla: el snapshot quedó atrás. `db:generate` va a proponer SQL
    // basura (potencialmente DESTRUCTIVO) porque compara contra un estado viejo.
    // Arreglo: regenerar el snapshot del último índice, NO confiar en generate.
    expect(pending, `db:generate propondría ${pending.length} sentencia(s):\n${pending.join("\n")}`).toEqual([]);
  }, 60_000);

  it("aplicar migrations/ produce exactamente el esquema que schema.ts declara", async () => {
    const fromSchema = generateDrizzleJson(schema as unknown as Record<string, unknown>);
    const ddl = await generateMigration(generateDrizzleJson({}), fromSchema);
    expect(ddl.length).toBeGreaterThan(0); // sanidad: el esquema no está vacío

    const desdeMigraciones = await fingerprint(async (db) => {
      await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
    });
    const desdeEsquema = await fingerprint(async (db) => {
      // drizzle-kit DDL assumes the extension already exists; migrations create it.
      await db.execute(sql.raw("CREATE EXTENSION IF NOT EXISTS vector;"));
      for (const statement of ddl) await db.execute(sql.raw(statement));
    });

    // Si esto falla: alguien escribió SQL a mano que no coincide con `schema.ts`
    // (o al revés). El diff dice exactamente qué línea sobra o falta.
    expect(desdeMigraciones).toBe(desdeEsquema);
  }, 120_000);
});
