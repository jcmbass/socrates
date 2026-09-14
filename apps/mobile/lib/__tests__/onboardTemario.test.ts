import { describe, expect, it } from "vitest";

import { moveOrderedId, orderedTopicIds, sortedTopics } from "../onboardTemario";
import type { Tema, Temario } from "../api/types";

function topic(overrides: Partial<Tema>): Tema {
  return {
    id: "t1",
    temarioId: "temario-1",
    order: 0,
    title: "Tema",
    status: "new",
    stars: 0,
    recommended: false,
    unitLabel: null,
    schemaVersion: 1,
    ...overrides,
  };
}

function temario(topics: Tema[]): Temario {
  return {
    id: "temario-1",
    subjectId: "subject-1",
    userId: "user-1",
    topics,
    milestones: [],
    generatedBy: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
  };
}

describe("sortedTopics / orderedTopicIds", () => {
  it("sorts regardless of input array order", () => {
    const t = temario([topic({ id: "b", order: 1 }), topic({ id: "a", order: 0 }), topic({ id: "c", order: 2 })]);
    expect(sortedTopics(t).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(orderedTopicIds(t)).toEqual(["a", "b", "c"]);
  });
});

describe("moveOrderedId", () => {
  const ids = ["a", "b", "c"];

  it("swaps with the previous id on 'up'", () => {
    expect(moveOrderedId(ids, "b", "up")).toEqual(["b", "a", "c"]);
  });

  it("swaps with the next id on 'down'", () => {
    expect(moveOrderedId(ids, "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at the top edge", () => {
    expect(moveOrderedId(ids, "a", "up")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op at the bottom edge", () => {
    expect(moveOrderedId(ids, "c", "down")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op for an unknown id", () => {
    expect(moveOrderedId(ids, "z", "up")).toEqual(["a", "b", "c"]);
  });
});
