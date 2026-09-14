import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { createSubject, listSubjectsByCourse } from "../repositories/subjects";
import { findCourseById } from "../repositories/courses";
import { createTemario } from "../repositories/temarios";
import { seedChallengeDefinitions } from "../seeds/challenge-definitions";
import { sanitizeSubject } from "@buxo/core/subject";

const CreateSubjectSchema = z.object({
  courseId: z.string().min(1),
  name: z.string().min(1),
});

export function createSubjectsRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const userId = c.get("userId");
    const courseId = c.req.query("courseId");
    if (!courseId) return errorResponse(c, "invalid_request", "courseId query param is required");
    const subjects = await listSubjectsByCourse(deps.db, userId, courseId);
    return c.json(subjects);
  });

  app.post("/", async (c) => {
    const parsed = CreateSubjectSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);
    const userId = c.get("userId");

    const course = await findCourseById(deps.db, parsed.data.courseId);
    if (!course || course.userId !== userId) return errorResponse(c, "not_found", "Course not found");

    // R6 (@buxo/core/subject): sanitize free-text subject names before they can ever reach a prompt.
    const name = sanitizeSubject(parsed.data.name);
    if (name.length === 0) return errorResponse(c, "invalid_request", "name is empty after sanitization");

    const subject = await createSubject(deps.db, { userId, courseId: parsed.data.courseId, name });
    // P1: every new subject gets an empty manual temario + seeded challenges.
    await createTemario(deps.db, { userId, subjectId: subject.id, generatedBy: "manual" });
    await seedChallengeDefinitions(deps.db, subject.id);
    return c.json(subject, 201);
  });

  return app;
}
