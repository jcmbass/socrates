import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { subjects } from "../db/schema";
import type { Subject } from "@buxo/domain/subject";
import { newId, nowIso } from "./ids";

function rowToSubject(row: typeof subjects.$inferSelect): Subject {
  return {
    id: row.id,
    userId: row.userId,
    courseId: row.courseId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    seedCatalogKey: row.seedCatalogKey,
    seedLang: row.seedLang,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateSubjectInput {
  userId: string;
  courseId: string;
  name: string;
  /** Seed catalog provenance, e.g. "universidad/quimica" — omitted/null for a student's own subject (C1-b). */
  seedCatalogKey?: string | null;
  /** Material language frozen at activation time for a seed subject (C1-b/C2-a). */
  seedLang?: string | null;
}

export async function createSubject(db: Db, input: CreateSubjectInput): Promise<Subject> {
  const now = nowIso();
  const [row] = await db
    .insert(subjects)
    .values({
      id: newId(),
      userId: input.userId,
      courseId: input.courseId,
      name: input.name,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      seedCatalogKey: input.seedCatalogKey ?? null,
      seedLang: input.seedLang ?? null,
      schemaVersion: 1,
    })
    .returning();
  return rowToSubject(row);
}

/**
 * C2-a idempotency check: has this course already activated this seed
 * catalog? Backs the "activate the same materia twice → no duplicate"
 * contract of `POST /v1/courses/:courseId/seed-subjects`.
 */
export async function findSubjectByCourseAndSeedCatalogKey(
  db: Db,
  courseId: string,
  seedCatalogKey: string,
): Promise<Subject | null> {
  const [row] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.courseId, courseId), eq(subjects.seedCatalogKey, seedCatalogKey)))
    .limit(1);
  return row ? rowToSubject(row) : null;
}

export async function listSubjectsByCourse(db: Db, userId: string, courseId: string): Promise<Subject[]> {
  const rows = await db.select().from(subjects).where(and(eq(subjects.userId, userId), eq(subjects.courseId, courseId)));
  return rows.map(rowToSubject);
}

export async function listSubjectsByUser(db: Db, userId: string): Promise<Subject[]> {
  const rows = await db.select().from(subjects).where(eq(subjects.userId, userId));
  return rows.map(rowToSubject);
}

export async function findSubjectById(db: Db, id: string): Promise<Subject | null> {
  const [row] = await db.select().from(subjects).where(eq(subjects.id, id)).limit(1);
  return row ? rowToSubject(row) : null;
}
