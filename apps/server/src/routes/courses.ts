import { Hono } from "hono";
import { z } from "zod";
import { EL_SALVADOR_GRADE_LEVELS } from "@buxo/domain/data/el-salvador";
import { SEED_CATALOGS } from "@buxo/domain/data/seed";
import { SeedSubjectKeySchema, type SeedLevel } from "@buxo/domain/seed-catalog";
import { sanitizeSubject } from "@buxo/core/subject";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { createCourse, findCourseById, listCoursesByUser } from "../repositories/courses";
import { createSubject, findSubjectByCourseAndSeedCatalogKey } from "../repositories/subjects";
import { createTemario, createTopicsInTemario } from "../repositories/temarios";
import { findUserById, setCurrentCourse } from "../repositories/users";
import { seedChallengeDefinitions } from "../seeds/challenge-definitions";

const ENABLED_GRADE_LEVEL_IDS = new Set(EL_SALVADOR_GRADE_LEVELS.filter((g) => g.enabled).map((g) => g.id));

/** `Course.gradeLevelId` (e.g. "sv-bachillerato-1") -> the seed level ("bachillerato") it maps to, via the real EducationStage — not a string-prefix guess. `null` for a stage with no seed catalogs (básica). */
const SEED_LEVEL_BY_STAGE_ID: Record<string, SeedLevel> = {
  "sv-bachillerato": "bachillerato",
  "sv-universidad": "universidad",
};

function seedLevelForGradeLevel(gradeLevelId: string): SeedLevel | null {
  const grade = EL_SALVADOR_GRADE_LEVELS.find((g) => g.id === gradeLevelId);
  if (!grade) return null;
  return SEED_LEVEL_BY_STAGE_ID[grade.stageId] ?? null;
}

const CreateCourseSchema = z.object({
  gradeLevelId: z.string().min(1),
  academicYear: z.number().int().optional(),
});

const SeedSubjectsBodySchema = z.object({
  subjectKeys: z.array(z.string().min(1)).min(1),
});

export function createCoursesRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const userId = c.get("userId");
    const courses = await listCoursesByUser(deps.db, userId);
    return c.json(courses);
  });

  app.post("/", async (c) => {
    const parsed = CreateCourseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    // I-7 (@buxo/domain/invariants): Course.gradeLevelId must reference an ENABLED GradeLevel at creation time.
    if (!ENABLED_GRADE_LEVEL_IDS.has(parsed.data.gradeLevelId)) {
      return errorResponse(c, "invalid_request", `gradeLevelId "${parsed.data.gradeLevelId}" is not an enabled grade level (I-7)`);
    }

    const userId = c.get("userId");
    const course = await createCourse(deps.db, {
      userId,
      gradeLevelId: parsed.data.gradeLevelId,
      academicYear: parsed.data.academicYear ?? null,
    });
    await setCurrentCourse(deps.db, userId, course.id);
    return c.json(course, 201);
  });

  /**
   * POST /v1/courses/:courseId/seed-subjects — C2-a. Activates one or more
   * seed subjects (matemáticas/física/química/biología/economía) on this
   * course: creates the `Subject` (with `seedCatalogKey`/`seedLang`
   * provenance) plus its `Temario`, with every topic from
   * `syllabus[seedLang]` copied in, `unitLabel` populated from the
   * catalog's `unit`. Never creates `Hito` milestones (out of scope, ADENDA
   * §R-2/§(a)).
   *
   * `seedLang` is derived from `users.preferredLanguageCode` ONCE, at
   * activation time, and frozen onto the subject (D-C04): `"en"` maps to
   * the English syllabus, everything else to the Spanish one. This is
   * intentionally NOT re-derived later — a student who switches locale
   * after activating must not have their temario (and any progress on it)
   * silently regenerated in the other language.
   *
   * 200 (not 201): this is "ensure these materias are activated", not a
   * strict creation — re-sending an already-activated key is a no-op that
   * still returns 200 with the existing `Subject` in the array (idempotency
   * requirement below), so a single status code covers every case.
   *
   * Idempotent per `(courseId, seedCatalogKey)`: activating the same
   * subjectKey twice does not duplicate the Subject/Temario/topics — it
   * returns the already-created Subject.
   */
  app.post("/:courseId/seed-subjects", async (c) => {
    const parsed = SeedSubjectsBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const userId = c.get("userId");
    const courseId = c.req.param("courseId");
    const course = await findCourseById(deps.db, courseId);
    if (!course || course.userId !== userId) return errorResponse(c, "not_found", "Course not found");

    const level = seedLevelForGradeLevel(course.gradeLevelId);
    if (!level) {
      return errorResponse(c, "invalid_request", `Course gradeLevelId "${course.gradeLevelId}" does not map to a seed level`);
    }

    const user = await findUserById(deps.db, userId);
    if (!user) return errorResponse(c, "not_found", "User not found");
    // D-C04: "en" -> English syllabus; anything else (including future locales) -> Spanish, the only other syllabus the catalogs carry.
    const seedLang: "es" | "en" = user.preferredLanguageCode === "en" ? "en" : "es";

    const activated = [];
    for (const rawKey of parsed.data.subjectKeys) {
      const keyParsed = SeedSubjectKeySchema.safeParse(rawKey);
      if (!keyParsed.success) return errorResponse(c, "invalid_request", `Unknown seed subjectKey "${rawKey}"`);
      const subjectKey = keyParsed.data;

      const catalog = SEED_CATALOGS.find((cat) => cat.level === level && cat.subject_key === subjectKey);
      if (!catalog) return errorResponse(c, "invalid_request", `No seed catalog for "${level}/${subjectKey}"`);

      const seedCatalogKey = `${level}/${subjectKey}`;
      const existing = await findSubjectByCourseAndSeedCatalogKey(deps.db, courseId, seedCatalogKey);
      if (existing) {
        activated.push(existing);
        continue;
      }

      const name = sanitizeSubject(catalog.subject_name[seedLang]);
      const subject = await createSubject(deps.db, {
        userId,
        courseId,
        name,
        seedCatalogKey,
        seedLang,
      });
      const temario = await createTemario(deps.db, { userId, subjectId: subject.id, generatedBy: "manual" });

      // R6/P0-2: every Tema.title must equal `sanitizeSubject(title)` —
      // pre-sanitize HERE (not just rely on `createTopic`'s internal call)
      // because several catalog titles run past the 60-char cap (up to 102
      // chars in universidad/fisica en) and `sanitizeSubject` is idempotent
      // but NOT a no-op on those — applying it once here, before the batch
      // insert's own `createTopic` call re-applies it, keeps both calls
      // agreeing on the same (truncated) string instead of the invariant
      // rejecting the raw one. Silent truncation is the existing platform
      // behavior for every topic title (manual/AI-built temarios included),
      // not a new decision made here — flagged in the DEVLOG as a product
      // question (~90 of the ~1997 catalog topics get shortened).
      const flatTopics = catalog.syllabus[seedLang].flatMap((unit) =>
        unit.topics.map((title) => ({ title: sanitizeSubject(title), unitLabel: unit.unit })),
      );
      await createTopicsInTemario(deps.db, temario.id, flatTopics);
      await seedChallengeDefinitions(deps.db, subject.id);

      activated.push(subject);
    }

    return c.json(activated, 200);
  });

  return app;
}
