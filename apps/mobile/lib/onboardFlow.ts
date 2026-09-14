/**
 * P3 onboarding wizard — network orchestration, factored out of the
 * app/onboard/*.tsx screens so it stays unit-testable under vitest (screens
 * import RN/expo-router and are outside this project's test surface, see
 * `vitest.config.ts`'s docblock). Each function takes only the `ApiClient`
 * methods it actually calls (`Pick<ApiClient, ...>`) rather than the whole
 * interface — that keeps a test's fake tiny AND documents the real
 * dependency surface.
 *
 * Nothing here is a new concept: paso-1/paso-2 reuse EXACTLY the
 * create-course-then-create-subjects sequence `courses/new.tsx` already
 * ships (R3 — no reimplementation), just split across two screens per the
 * maqueta's 3-step flow. paso-3's `createManualTemario`/
 * `generateTemarioForSubject` are thin pass-throughs to P2's client
 * methods — kept as named functions (not inlined) purely so a test can
 * assert the wizard calls them with the right args, per this phase's spec.
 */
import type { ApiClient } from "./api/client";
import type { Course, Subject, Temario } from "./api/types";

/**
 * paso-1 "Continuar" — creates the Course for the chosen grade level.
 * `academicYear` is left to the server default, same as `courses/new.tsx`
 * today; this phase doesn't add a year picker beyond what the catalog
 * already flattens (bachillerato's 3 años are 3 separate GradeLevels, so
 * no extra "which año" step is needed — see DEVLOG for why the maqueta's
 * separate bachi-year modal doesn't apply to the real catalog shape).
 */
export function createOnboardCourse(
  client: Pick<ApiClient, "createCourse">,
  token: string,
  gradeLevelId: string,
): Promise<Course> {
  return client.createCourse(token, { gradeLevelId });
}

/**
 * P4 fix for the "Course huérfano" debt flagged in P3's DEVLOG/REVIEW: if the
 * student backs out of paso-2/paso-3 (native back) and taps "Continuar" on
 * paso-1 again, `createOnboardCourse` used to create a SECOND `Course` for
 * the same grade level — the first one left behind, empty, invisible but
 * present in `GET /v1/courses` forever (no delete/archive path for a course
 * with zero subjects exists, and adding one is out of this phase's scope).
 *
 * Fix: before creating, look for an ACTIVE course the student already has
 * for this exact `gradeLevelId` and reuse it instead of creating a new one.
 * This is deliberately narrow — it does not try to guess "which course did
 * I create three screens ago" via local-only state (the wizard's draft
 * store is memory-only and wouldn't survive an app kill anyway); it asks the
 * server, which is the source of truth, for a course that already matches
 * what the student is about to ask for again. A student who legitimately
 * wants a second course for the SAME grade level (e.g. retaking a year) is
 * not a scenario the current onboarding flow supports at all (it only ever
 * runs once, gated by `needsOnboarding`), so this reuse doesn't block any
 * real use case.
 */
export async function findOrCreateOnboardCourse(
  client: Pick<ApiClient, "listCourses" | "createCourse">,
  token: string,
  gradeLevelId: string,
): Promise<Course> {
  const courses = await client.listCourses(token);
  const existing = courses.find((c) => c.status === "active" && c.gradeLevelId === gradeLevelId);
  if (existing) return existing;
  return createOnboardCourse(client, token, gradeLevelId);
}

/**
 * paso-2 "Continuar" — creates one Subject per selected name, IN ORDER
 * (small counts, order matters for display — same sequential-await
 * pattern `courses/new.tsx` uses for its pre-checked templates).
 */
export async function createOnboardSubjects(
  client: Pick<ApiClient, "createSubject">,
  token: string,
  courseId: string,
  names: readonly string[],
): Promise<Subject[]> {
  const subjects: Subject[] = [];
  for (const name of names) {
    subjects.push(await client.createSubject(token, { courseId, name }));
  }
  return subjects;
}

/**
 * paso-2 "Continuar" (C2-c) — activates the selected seed subjects on the
 * course: server creates the Subject + Temario per key (idempotent per
 * `(courseId, subjectKey)`, C2-a). Short-circuits on an empty list rather
 * than making a pointless request — same guard shape as
 * `createOnboardSubjects` below for zero names.
 */
export function activateOnboardSeedSubjects(
  client: Pick<ApiClient, "activateSeedSubjects">,
  token: string,
  courseId: string,
  subjectKeys: readonly string[],
): Promise<Subject[]> {
  if (subjectKeys.length === 0) return Promise.resolve([]);
  return client.activateSeedSubjects(token, courseId, [...subjectKeys]);
}

/** paso-3 "Manual" — empty, student-editable temario (DF-P09). */
export function createManualTemario(
  client: Pick<ApiClient, "createTemario">,
  token: string,
  subjectId: string,
): Promise<Temario> {
  return client.createTemario(token, subjectId);
}

/**
 * paso-3 "Subir PDF" happy path — P2's agentic temario-builder. Wired from
 * onboard paso-3 and the empty temario screen via `useIngestToFuente` +
 * `lib/pdfToTemario.ts` (beta-real 05). Kept as a named pass-through so
 * tests can assert the call shape without going through the WebView host.
 */
export function generateTemarioForSubject(
  client: Pick<ApiClient, "generateTemario">,
  token: string,
  subjectId: string,
  fuenteId: string,
): Promise<{ temario: Temario; generatedBy: string }> {
  return client.generateTemario(token, subjectId, fuenteId);
}
