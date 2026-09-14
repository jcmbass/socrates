/**
 * plan-modal-rag F2 — persist offline embed vectors into an ephemeral pglite DB.
 *
 * Demonstrates the idempotent repo path end-to-end without touching Neon/prod
 * or student Fuentes. Reads infra/modal/results/f2_embed_vectors.json.
 *
 * Usage (from repo root):
 *   npx tsx apps/server/scripts/f2-persist-local.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { createTestDb } from "../src/db/test-db";
import { createUser } from "../src/repositories/users";
import { createCourse } from "../src/repositories/courses";
import { createSubject } from "../src/repositories/subjects";
import { createFuente } from "../src/repositories/fuentes";
import {
  countFuenteChunksForSubject,
  replaceFuenteChunksForFuentes,
} from "../src/repositories/fuente-chunks";
import { newId } from "../src/repositories/ids";

type VecFile = {
  model_id: string;
  dim: number;
  chunks: Array<{
    fuente_name: string;
    chunk_index: number;
    text: string;
    token_estimate: number;
    source_pdf: string;
    embedding: number[];
  }>;
};

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const vecPath = join(here, "../../../infra/modal/results/f2_embed_vectors.json");
  const raw = JSON.parse(readFileSync(vecPath, "utf8")) as VecFile;
  if (!raw.chunks?.length) throw new Error(`no chunks in ${vecPath}`);

  const t = await createTestDb();
  try {
    const user = await createUser(t.db, {
      email: `f2-local-${newId()}@example.com`,
      displayName: "F2 local",
      ageConfirmedAt: new Date().toISOString(),
    });
    const course = await createCourse(t.db, {
      userId: user.id,
      gradeLevelId: "sv-bachillerato-1",
    });
    const subject = await createSubject(t.db, {
      userId: user.id,
      courseId: course.id,
      name: "F2 docs corpus (synthetic)",
    });

    const byFuente = new Map<string, typeof raw.chunks>();
    for (const c of raw.chunks) {
      const list = byFuente.get(c.fuente_name) ?? [];
      list.push(c);
      byFuente.set(c.fuente_name, list);
    }

    const fuenteIds = new Map<string, string>();
    for (const name of byFuente.keys()) {
      const f = await createFuente(t.db, {
        userId: user.id,
        subjectId: subject.id,
        name,
        kind: "pdf",
        text: `(F2 offline corpus placeholder for ${name})`,
      });
      fuenteIds.set(name, f.id);
    }

    const chunks = raw.chunks.map((c) => ({
      subjectId: subject.id,
      fuenteId: fuenteIds.get(c.fuente_name)!,
      fuenteName: c.fuente_name,
      chunkIndex: c.chunk_index,
      text: c.text,
      tokenEstimate: c.token_estimate,
      embedding: c.embedding,
    }));

    const first = await replaceFuenteChunksForFuentes(t.db, {
      subjectId: subject.id,
      modelId: raw.model_id,
      chunks,
    });
    const second = await replaceFuenteChunksForFuentes(t.db, {
      subjectId: subject.id,
      modelId: raw.model_id,
      chunks,
    });

    const n = await countFuenteChunksForSubject(t.db, subject.id);
    // Cosine distance probe via pgvector operator
    const probe = await t.db.execute(sql`
      SELECT fuente_name, chunk_index,
             1 - (embedding <=> ${JSON.stringify(chunks[0]!.embedding)}::vector) AS score
      FROM fuente_chunks
      WHERE subject_id = ${subject.id}
      ORDER BY embedding <=> ${JSON.stringify(chunks[0]!.embedding)}::vector
      LIMIT 3`);

    console.log(
      JSON.stringify(
        {
          written_first: first.written,
          deleted_second: second.deleted,
          written_second: second.written,
          count: n,
          idempotent: second.written === n && n === first.written,
          nearest: probe.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await t.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
