import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { courses } from "../db/schema";
import type { Course } from "@buxo/domain/course";
import { newId, nowIso } from "./ids";

function rowToCourse(row: typeof courses.$inferSelect): Course {
  return {
    id: row.id,
    userId: row.userId,
    gradeLevelId: row.gradeLevelId,
    customLabel: row.customLabel,
    academicYear: row.academicYear,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateCourseInput {
  userId: string;
  gradeLevelId: string;
  customLabel?: string | null;
  academicYear?: number | null;
}

export async function createCourse(db: Db, input: CreateCourseInput): Promise<Course> {
  const now = nowIso();
  const [row] = await db
    .insert(courses)
    .values({
      id: newId(),
      userId: input.userId,
      gradeLevelId: input.gradeLevelId,
      customLabel: input.customLabel ?? null,
      academicYear: input.academicYear ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    })
    .returning();
  return rowToCourse(row);
}

export async function listCoursesByUser(db: Db, userId: string): Promise<Course[]> {
  const rows = await db.select().from(courses).where(eq(courses.userId, userId));
  return rows.map(rowToCourse);
}

export async function findCourseById(db: Db, id: string): Promise<Course | null> {
  const [row] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  return row ? rowToCourse(row) : null;
}
