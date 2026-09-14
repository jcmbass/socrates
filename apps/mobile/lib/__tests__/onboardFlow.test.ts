import { describe, expect, it, vi } from "vitest";

import {
  activateOnboardSeedSubjects,
  createManualTemario,
  createOnboardCourse,
  createOnboardSubjects,
  findOrCreateOnboardCourse,
  generateTemarioForSubject,
} from "../onboardFlow";
import type { Course, Subject, Temario } from "../api/types";

const TOKEN = "jwt-token";

function fakeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    userId: "user-1",
    gradeLevelId: "sv-bachillerato-1",
    customLabel: null,
    academicYear: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

function fakeSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "subject-1",
    userId: "user-1",
    courseId: "course-1",
    name: "Matemática",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    seedCatalogKey: null,
    seedLang: null,
    schemaVersion: 1,
    ...overrides,
  };
}

function fakeTemario(overrides: Partial<Temario> = {}): Temario {
  return {
    id: "temario-1",
    subjectId: "subject-1",
    userId: "user-1",
    topics: [],
    milestones: [],
    generatedBy: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("createOnboardCourse", () => {
  it("calls createCourse with the token and gradeLevelId, nothing else", async () => {
    const createCourse = vi.fn().mockResolvedValue(fakeCourse());
    const result = await createOnboardCourse({ createCourse }, TOKEN, "sv-bachillerato-1");
    expect(createCourse).toHaveBeenCalledWith(TOKEN, { gradeLevelId: "sv-bachillerato-1" });
    expect(result.id).toBe("course-1");
  });
});

describe("findOrCreateOnboardCourse (P4 — Course huérfano dedup)", () => {
  it("reuses an existing ACTIVE course for the same grade level instead of creating a duplicate", async () => {
    const existing = fakeCourse({ id: "course-existing", gradeLevelId: "sv-bachillerato-1", status: "active" });
    const listCourses = vi.fn().mockResolvedValue([existing]);
    const createCourse = vi.fn();
    const result = await findOrCreateOnboardCourse({ listCourses, createCourse }, TOKEN, "sv-bachillerato-1");
    expect(result).toEqual(existing);
    expect(createCourse).not.toHaveBeenCalled();
  });

  it("creates a new course when none of the caller's active courses match the grade level", async () => {
    const other = fakeCourse({ id: "course-other", gradeLevelId: "sv-bachillerato-2", status: "active" });
    const listCourses = vi.fn().mockResolvedValue([other]);
    const created = fakeCourse({ id: "course-new", gradeLevelId: "sv-bachillerato-1" });
    const createCourse = vi.fn().mockResolvedValue(created);
    const result = await findOrCreateOnboardCourse({ listCourses, createCourse }, TOKEN, "sv-bachillerato-1");
    expect(result).toEqual(created);
    expect(createCourse).toHaveBeenCalledWith(TOKEN, { gradeLevelId: "sv-bachillerato-1" });
  });

  it("ignores a matching course that is NOT active (e.g. archived) and creates a new one", async () => {
    const archived = fakeCourse({ id: "course-archived", gradeLevelId: "sv-bachillerato-1", status: "archived" });
    const listCourses = vi.fn().mockResolvedValue([archived]);
    const created = fakeCourse({ id: "course-new" });
    const createCourse = vi.fn().mockResolvedValue(created);
    const result = await findOrCreateOnboardCourse({ listCourses, createCourse }, TOKEN, "sv-bachillerato-1");
    expect(result).toEqual(created);
  });
});

describe("createOnboardSubjects", () => {
  it("creates one subject per name, sequentially, in order", async () => {
    const created: string[] = [];
    const createSubject = vi.fn().mockImplementation(async (_token: string, input: { courseId: string; name: string }) => {
      created.push(input.name);
      return fakeSubject({ id: `subject-${created.length}`, name: input.name, courseId: input.courseId });
    });

    const result = await createOnboardSubjects({ createSubject }, TOKEN, "course-1", ["Matemática", "Física", "Química"]);

    expect(createSubject).toHaveBeenCalledTimes(3);
    expect(created).toEqual(["Matemática", "Física", "Química"]);
    expect(result.map((s) => s.name)).toEqual(["Matemática", "Física", "Química"]);
    for (const call of createSubject.mock.calls) {
      expect(call[0]).toBe(TOKEN);
      expect((call[1] as { courseId: string }).courseId).toBe("course-1");
    }
  });

  it("resolves to an empty array for zero names, without calling the client", async () => {
    const createSubject = vi.fn();
    const result = await createOnboardSubjects({ createSubject }, TOKEN, "course-1", []);
    expect(result).toEqual([]);
    expect(createSubject).not.toHaveBeenCalled();
  });
});

describe("activateOnboardSeedSubjects (C2-c)", () => {
  it("calls activateSeedSubjects with the token, courseId, and keys", async () => {
    const activated = [fakeSubject({ id: "subject-1", name: "Matemática", seedCatalogKey: "matematica" })];
    const activateSeedSubjects = vi.fn().mockResolvedValue(activated);
    const result = await activateOnboardSeedSubjects({ activateSeedSubjects }, TOKEN, "course-1", ["matematica"]);
    expect(activateSeedSubjects).toHaveBeenCalledWith(TOKEN, "course-1", ["matematica"]);
    expect(result).toEqual(activated);
  });

  it("resolves to an empty array for zero keys, without calling the client", async () => {
    const activateSeedSubjects = vi.fn();
    const result = await activateOnboardSeedSubjects({ activateSeedSubjects }, TOKEN, "course-1", []);
    expect(result).toEqual([]);
    expect(activateSeedSubjects).not.toHaveBeenCalled();
  });
});

describe("createManualTemario", () => {
  it("calls createTemario with token + subjectId", async () => {
    const createTemario = vi.fn().mockResolvedValue(fakeTemario());
    const result = await createManualTemario({ createTemario }, TOKEN, "subject-1");
    expect(createTemario).toHaveBeenCalledWith(TOKEN, "subject-1");
    expect(result.generatedBy).toBe("manual");
  });
});

describe("generateTemarioForSubject", () => {
  it("calls generateTemario with token + subjectId + fuenteId and returns temario + generatedBy", async () => {
    const generateTemario = vi.fn().mockResolvedValue({
      temario: fakeTemario({ generatedBy: "ai" }),
      generatedBy: "ai",
      result: { text: "...", servedBy: { providerId: "anthropic", modelId: "claude-haiku-4-5" }, promptVersion: "v2" },
    });
    const result = await generateTemarioForSubject({ generateTemario }, TOKEN, "subject-1", "fuente-1");
    expect(generateTemario).toHaveBeenCalledWith(TOKEN, "subject-1", "fuente-1");
    expect(result.generatedBy).toBe("ai");
    expect(result.temario.generatedBy).toBe("ai");
  });
});
