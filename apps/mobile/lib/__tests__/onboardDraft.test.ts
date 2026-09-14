import { describe, expect, it } from "vitest";

import { createOnboardDraftStore, EMPTY_ONBOARD_DRAFT } from "../onboardDraft";

describe("onboardDraft store", () => {
  it("starts empty", () => {
    const store = createOnboardDraftStore();
    expect(store.getState().gradeLevelId).toBeNull();
    expect(store.getState().courseId).toBeNull();
    expect(store.getState().subjects).toEqual([]);
  });

  it("setGrade records the grade level and the created course id", () => {
    const store = createOnboardDraftStore();
    store.getState().setGrade({ gradeLevelId: "sv-bachillerato-2", courseId: "course-1" });
    expect(store.getState().gradeLevelId).toBe("sv-bachillerato-2");
    expect(store.getState().courseId).toBe("course-1");
  });

  it("setSubjects records the created subjects, independent of grade", () => {
    const store = createOnboardDraftStore();
    store.getState().setGrade({ gradeLevelId: "sv-bachillerato-2", courseId: "course-1" });
    store.getState().setSubjects([{ id: "s1", name: "Matemática" }, { id: "s2", name: "Física" }]);
    expect(store.getState().subjects).toEqual([{ id: "s1", name: "Matemática" }, { id: "s2", name: "Física" }]);
    expect(store.getState().courseId).toBe("course-1");
  });

  it("reset drops back to empty", () => {
    const store = createOnboardDraftStore();
    store.getState().setGrade({ gradeLevelId: "sv-bachillerato-2", courseId: "course-1" });
    store.getState().setSubjects([{ id: "s1", name: "Matemática" }]);
    store.getState().reset();
    expect(store.getState()).toMatchObject(EMPTY_ONBOARD_DRAFT);
  });
});
