import { describe, expect, it } from "vitest";

import type { Fuente, Temario } from "../api/types";
import { isTemarioEffectivelyEmpty, pickRetryFuente } from "../temarioEmpty";

function temario(overrides: Partial<Temario> = {}): Temario {
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

function fuente(id: string, createdAt: string): Fuente {
  return {
    id,
    subjectId: "subject-1",
    userId: "user-1",
    name: `${id}.pdf`,
    kind: "pdf",
    text: "…",
    createdAt,
    schemaVersion: 1,
  };
}

describe("isTemarioEffectivelyEmpty", () => {
  it("treats null/undefined as empty (same student-facing state as an empty row)", () => {
    expect(isTemarioEffectivelyEmpty(null)).toBe(true);
    expect(isTemarioEffectivelyEmpty(undefined)).toBe(true);
  });

  it("treats a shell with zero topics and zero milestones as empty (failed-generate orphan)", () => {
    expect(isTemarioEffectivelyEmpty(temario())).toBe(true);
  });

  it("is false when there is at least one topic", () => {
    expect(
      isTemarioEffectivelyEmpty(
        temario({
          topics: [
            {
              id: "t1",
              temarioId: "temario-1",
              order: 0,
              title: "Átomos",
              status: "new",
              stars: 0,
              recommended: true,
              unitLabel: null,
              schemaVersion: 1,
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe("pickRetryFuente", () => {
  it("returns null when there are no fuentes", () => {
    expect(pickRetryFuente([])).toBeNull();
  });

  it("picks the most recently created fuente (app-restart recovery)", () => {
    const older = fuente("old", "2026-01-01T00:00:00.000Z");
    const newer = fuente("new", "2026-07-28T12:00:00.000Z");
    expect(pickRetryFuente([older, newer])?.id).toBe("new");
    expect(pickRetryFuente([newer, older])?.id).toBe("new");
  });
});
