import { describe, expect, it } from "vitest";
import { buildSubjectCard, buildSubjectCards, deriveSubjectStatus, deriveXpDisplay, selectHeroCard } from "../homeCards";
import type { Subject, Tema, Temario } from "../api/types";

function fakeSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "subject-1",
    userId: "user-1",
    courseId: "course-1",
    name: "Química 1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    seedCatalogKey: null,
    seedLang: null,
    schemaVersion: 1,
    ...overrides,
  };
}

function fakeTopic(overrides: Partial<Tema> = {}): Tema {
  return {
    id: "topic-1",
    temarioId: "temario-1",
    order: 0,
    title: "Estequiometría",
    status: "new",
    stars: 0,
    recommended: false,
    unitLabel: null,
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

describe("deriveSubjectStatus", () => {
  it("is 'empty' when there is no temario at all", () => {
    expect(deriveSubjectStatus(null)).toBe("empty");
  });

  it("is 'empty' when the temario has zero topics", () => {
    expect(deriveSubjectStatus(fakeTemario())).toBe("empty");
  });

  it("is 'configured' once the temario has at least one topic", () => {
    expect(deriveSubjectStatus(fakeTemario({ topics: [fakeTopic()] }))).toBe("configured");
  });
});

describe("buildSubjectCard", () => {
  it("picks the recommended topic's title as currentTopicTitle when set", () => {
    const temario = fakeTemario({
      topics: [
        fakeTopic({ id: "t1", order: 0, title: "Átomos", status: "done" }),
        fakeTopic({ id: "t2", order: 1, title: "Enlace químico", recommended: true }),
      ],
    });
    const card = buildSubjectCard(fakeSubject(), temario);
    expect(card.currentTopicTitle).toBe("Enlace químico");
    expect(card.topicCount).toBe(2);
    expect(card.status).toBe("configured");
  });

  it("falls back to the first not-done topic in order when nothing is explicitly recommended", () => {
    const temario = fakeTemario({
      topics: [
        fakeTopic({ id: "t1", order: 0, title: "Átomos", status: "done" }),
        fakeTopic({ id: "t2", order: 1, title: "Enlace químico", status: "new" }),
        fakeTopic({ id: "t3", order: 2, title: "Termoquímica", status: "new" }),
      ],
    });
    expect(buildSubjectCard(fakeSubject(), temario).currentTopicTitle).toBe("Enlace químico");
  });

  it("currentTopicTitle is null when every topic is done", () => {
    const temario = fakeTemario({ topics: [fakeTopic({ status: "done" })] });
    expect(buildSubjectCard(fakeSubject(), temario).currentTopicTitle).toBeNull();
  });

  it("currentTopicTitle is null for an empty/missing temario", () => {
    expect(buildSubjectCard(fakeSubject(), null).currentTopicTitle).toBeNull();
  });
});

/**
 * C2-e — `materialInEnglish` derivation. The home screen feeds
 * `buildSubjectCard` the `TemarioWithVisibility` payload `getTemario`
 * already returns per subject (no new fetch); the flag mirrors the server's
 * `seedMaterialLang` (the book behind the temario, which can be EN-only
 * even for an `es` student, e.g. `bachillerato/fisica` — OpenStax
 * "Physics").
 */
describe("buildSubjectCard — materialInEnglish (C2-e)", () => {
  function fakeSeedTemario(seedCatalogKey: string | null, seedMaterialLang: "es" | "en" | null) {
    return { ...fakeTemario({ topics: [fakeTopic()] }), visibility: "visible" as const, seedCatalogKey, seedMaterialLang };
  }

  it("true when the resolved source lang is 'en' for a real seed subject (bachillerato/fisica fallback)", () => {
    const card = buildSubjectCard(fakeSubject(), fakeSeedTemario("bachillerato/fisica", "en"));
    expect(card.materialInEnglish).toBe(true);
  });

  it("false when the source lang matches the student's language ('es')", () => {
    const card = buildSubjectCard(fakeSubject(), fakeSeedTemario("universidad/fisica", "es"));
    expect(card.materialInEnglish).toBe(false);
  });

  it("false for a manual subject (no seed catalog key) even if the field were somehow 'en'", () => {
    const card = buildSubjectCard(fakeSubject(), fakeSeedTemario(null, "en"));
    expect(card.materialInEnglish).toBe(false);
  });

  it("false for an empty/missing temario (absent fields degrade to 'no note')", () => {
    expect(buildSubjectCard(fakeSubject(), null).materialInEnglish).toBe(false);
    expect(buildSubjectCard(fakeSubject(), fakeTemario()).materialInEnglish).toBe(false);
  });
});

describe("buildSubjectCard — doneCount/starsTotal", () => {
  it("doneCount/starsTotal are 0 for an empty/missing temario", () => {
    const card = buildSubjectCard(fakeSubject(), null);
    expect(card.doneCount).toBe(0);
    expect(card.starsTotal).toBe(0);
    expect(card.topicCount).toBe(0);
  });

  it("doneCount counts only status==='done' topics; starsTotal sums every topic's stars", () => {
    const temario = fakeTemario({
      topics: [
        fakeTopic({ id: "t1", order: 0, status: "done", stars: 3 }),
        fakeTopic({ id: "t2", order: 1, status: "done", stars: 2 }),
        fakeTopic({ id: "t3", order: 2, status: "new", stars: 0 }),
      ],
    });
    const card = buildSubjectCard(fakeSubject(), temario);
    expect(card.doneCount).toBe(2);
    expect(card.topicCount).toBe(3);
    expect(card.starsTotal).toBe(5);
  });
});

describe("buildSubjectCards", () => {
  it("zips subjects with their matching temario by index", () => {
    const subjects = [fakeSubject({ id: "s1" }), fakeSubject({ id: "s2" })];
    const temarios = [fakeTemario({ topics: [fakeTopic()] }), null];
    const cards = buildSubjectCards(subjects, temarios);
    expect(cards.map((c) => c.status)).toEqual(["configured", "empty"]);
  });
});

describe("selectHeroCard", () => {
  it("returns null when no subject has a configured temario", () => {
    const subjects = [fakeSubject({ id: "s1" }), fakeSubject({ id: "s2" })];
    const cards = buildSubjectCards(subjects, [null, fakeTemario()]);
    expect(selectHeroCard(cards)).toBeNull();
  });

  it("prefers the subject with visible partial progress over one at 0% or 100%", () => {
    const subjects = [fakeSubject({ id: "s1", name: "Biología" }), fakeSubject({ id: "s2", name: "Química" })];
    const temarios = [
      // s1: configured but 0% done (nothing started yet).
      fakeTemario({ topics: [fakeTopic({ id: "b1", status: "new" }), fakeTopic({ id: "b2", order: 1, status: "new" })] }),
      // s2: partial — 1 of 2 done, the clear "continue" candidate.
      fakeTemario({ topics: [fakeTopic({ id: "q1", status: "done" }), fakeTopic({ id: "q2", order: 1, status: "new" })] }),
    ];
    const cards = buildSubjectCards(subjects, temarios);
    expect(selectHeroCard(cards)?.subject.id).toBe("s2");
  });

  it("picks the higher partial-progress ratio when multiple subjects are in progress", () => {
    const subjects = [fakeSubject({ id: "s1" }), fakeSubject({ id: "s2" })];
    const temarios = [
      // s1: 1/4 done (25%)
      fakeTemario({
        topics: [
          fakeTopic({ id: "a1", order: 0, status: "done" }),
          fakeTopic({ id: "a2", order: 1, status: "new" }),
          fakeTopic({ id: "a3", order: 2, status: "new" }),
          fakeTopic({ id: "a4", order: 3, status: "new" }),
        ],
      }),
      // s2: 3/4 done (75%) — higher ratio, should win.
      fakeTemario({
        topics: [
          fakeTopic({ id: "b1", order: 0, status: "done" }),
          fakeTopic({ id: "b2", order: 1, status: "done" }),
          fakeTopic({ id: "b3", order: 2, status: "done" }),
          fakeTopic({ id: "b4", order: 3, status: "new" }),
        ],
      }),
    ];
    const cards = buildSubjectCards(subjects, temarios);
    expect(selectHeroCard(cards)?.subject.id).toBe("s2");
  });

  it("falls back to the FIRST configured subject when none has partial progress", () => {
    const subjects = [fakeSubject({ id: "s1" }), fakeSubject({ id: "s2" })];
    const temarios = [
      // s1: 100% done.
      fakeTemario({ topics: [fakeTopic({ id: "a1", status: "done" })] }),
      // s2: 0% done.
      fakeTemario({ topics: [fakeTopic({ id: "b1", status: "new" })] }),
    ];
    const cards = buildSubjectCards(subjects, temarios);
    expect(selectHeroCard(cards)?.subject.id).toBe("s1");
  });

  it("ignores 'empty' subjects even if a later one has partial progress", () => {
    const subjects = [fakeSubject({ id: "s1" }), fakeSubject({ id: "s2" })];
    const temarios = [
      null, // s1: no temario at all
      fakeTemario({ topics: [fakeTopic({ id: "b1", status: "done" }), fakeTopic({ id: "b2", order: 1, status: "new" })] }),
    ];
    const cards = buildSubjectCards(subjects, temarios);
    expect(selectHeroCard(cards)?.subject.id).toBe("s2");
  });
});

describe("deriveXpDisplay (antifuga degradation)", () => {
  it("hides the number when visible is absent (shadow mode)", () => {
    expect(deriveXpDisplay({ policy: "subtract", subjectId: null } as never)).toEqual({ visible: false, total: 0 });
  });

  it("hides the number for a null/undefined payload (loading or failed fetch) — never throws", () => {
    expect(deriveXpDisplay(null)).toEqual({ visible: false, total: 0 });
    expect(deriveXpDisplay(undefined)).toEqual({ visible: false, total: 0 });
  });

  it("shows the number when visible is present (visible mode)", () => {
    expect(deriveXpDisplay({ visible: 120 })).toEqual({ visible: true, total: 120 });
  });

  it("shows zero as a real value, not as 'hidden'", () => {
    expect(deriveXpDisplay({ visible: 0 })).toEqual({ visible: true, total: 0 });
  });
});
