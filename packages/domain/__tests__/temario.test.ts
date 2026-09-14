import { describe, expect, it } from "vitest";
import {
  HITO_KINDS,
  HITO_STATUSES,
  TEMA_STATUSES,
  TEMARIO_GENERATED_BY,
  TemarioSchema,
  computeMilestoneScope,
  createMilestone,
  createTopic,
  deserializeTemario,
  emptyTemario,
  newMilestoneId,
  newTemarioId,
  newTopicId,
  parseMilestone,
  parseTemario,
  parseTopic,
  projectTemarioVisibility,
  projectTemasVisibility,
  serializeMilestone,
  serializeTemario,
  serializeTopic,
  type Hito,
  type Tema,
  type Temario,
} from "../temario";

const TS = "2026-07-21T10:00:00.000Z";
const NOW = new Date(TS);

function makeTemario(overrides: Partial<Temario> = {}): Temario {
  return {
    id: newTemarioId(NOW),
    subjectId: "subject-1",
    userId: "user-1",
    topics: [],
    milestones: [],
    generatedBy: "manual",
    createdAt: TS,
    updatedAt: TS,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeTopic(overrides: Partial<Tema> = {}): Tema {
  return {
    id: newTopicId(NOW),
    temarioId: "temario-1",
    order: 0,
    title: "Límites y continuidad",
    status: "new",
    stars: 0,
    recommended: false,
    unitLabel: null,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Hito> = {}): Hito {
  return {
    id: newMilestoneId(NOW),
    temarioId: "temario-1",
    order: 1,
    kind: "parcial",
    title: "Parcial 1",
    coversUpToOrder: 0,
    status: "available",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("Temario schemas", () => {
  it("accepts a well-formed empty Temario", () => {
    expect(TemarioSchema.safeParse(makeTemario()).success).toBe(true);
  });

  it("accepts every generatedBy value", () => {
    for (const generatedBy of TEMARIO_GENERATED_BY) {
      expect(TemarioSchema.safeParse(makeTemario({ generatedBy })).success).toBe(true);
    }
  });

  it("rejects an invalid generatedBy", () => {
    expect(TemarioSchema.safeParse(makeTemario({ generatedBy: "magic" as never })).success).toBe(false);
  });

  it("rejects a topic with negative order", () => {
    expect(TemarioSchema.safeParse(makeTemario({ topics: [makeTopic({ order: -1 })] })).success).toBe(false);
  });

  it("rejects stars outside 0..3", () => {
    expect(TemarioSchema.safeParse(makeTemario({ topics: [makeTopic({ stars: 4 as never })] })).success).toBe(false);
  });

  it("rejects an invalid milestone kind", () => {
    expect(
      TemarioSchema.safeParse(makeTemario({ milestones: [makeMilestone({ kind: "quiz" as never })] })).success,
    ).toBe(false);
  });
});

describe("Pure factories", () => {
  it("emptyTemario creates a manual empty temario", () => {
    const temario = emptyTemario({ subjectId: "s1", userId: "u1", now: NOW });
    expect(temario.subjectId).toBe("s1");
    expect(temario.userId).toBe("u1");
    expect(temario.topics).toEqual([]);
    expect(temario.milestones).toEqual([]);
    expect(temario.generatedBy).toBe("manual");
    expect(temario.schemaVersion).toBe(1);
  });

  it("createTopic sanitizes the title and defaults to new/0 stars", () => {
    const topic = createTopic({ temarioId: "t1", order: 2, title: "  Derivadas\tcon\ncontrol  " });
    expect(topic.title).toBe("Derivadas con control");
    expect(topic.status).toBe("new");
    expect(topic.stars).toBe(0);
    expect(topic.recommended).toBe(false);
    expect(topic.order).toBe(2);
  });

  it("createMilestone builds a parcial with available status", () => {
    const milestone = createMilestone({
      temarioId: "t1",
      order: 3,
      kind: "parcial",
      title: "Parcial 1",
      coversUpToOrder: 2,
    });
    expect(milestone.kind).toBe("parcial");
    expect(milestone.status).toBe("available");
    expect(milestone.coversUpToOrder).toBe(2);
  });
});

describe("Serialization round-trip", () => {
  it("Temario round-trips through serialize/parse", () => {
    const temario = makeTemario({
      topics: [makeTopic({ order: 0 }), makeTopic({ order: 1, status: "studying" })],
      milestones: [makeMilestone({ order: 2, coversUpToOrder: 1 })],
    });
    const json = serializeTemario(temario);
    const restored = parseTemario(JSON.parse(json));
    expect(restored).toEqual(temario);
  });

  it("Topic round-trips", () => {
    const topic = makeTopic({ recommended: true });
    const restored = parseTopic(JSON.parse(serializeTopic(topic)));
    expect(restored).toEqual(topic);
  });

  it("Milestone round-trips", () => {
    const milestone = makeMilestone({ kind: "examen_final", coversUpToOrder: 4 });
    const restored = parseMilestone(JSON.parse(serializeMilestone(milestone)));
    expect(restored).toEqual(milestone);
  });

  it("parseTemario rejects malformed JSON strings via deserialize", () => {
    expect(() => deserializeTemario("not-json")).toThrow();
  });
});

describe("projectTemasVisibility / projectTemarioVisibility (P4 antifuga)", () => {
  it("zeroes every topic's stars in shadow, regardless of the stored value", () => {
    const topics = [makeTopic({ id: "t1", stars: 2 }), makeTopic({ id: "t2", stars: 3 })];
    const projected = projectTemasVisibility(topics, "shadow");
    expect(projected.map((t) => t.stars)).toEqual([0, 0]);
    // Everything else is untouched.
    expect(projected[0]!.title).toBe(topics[0]!.title);
  });

  it("passes stars through unchanged in visible", () => {
    const topics = [makeTopic({ id: "t1", stars: 2 }), makeTopic({ id: "t2", stars: 0 })];
    const projected = projectTemasVisibility(topics, "visible");
    expect(projected.map((t) => t.stars)).toEqual([2, 0]);
  });

  it("does not mutate the input array/objects (pure)", () => {
    const topics = [makeTopic({ id: "t1", stars: 3 })];
    const original = JSON.parse(JSON.stringify(topics));
    projectTemasVisibility(topics, "shadow");
    expect(topics).toEqual(original);
  });

  it("projectTemarioVisibility applies the same gate to a whole Temario, leaving milestones untouched", () => {
    const temario = makeTemario({
      topics: [makeTopic({ id: "t1", stars: 3 })],
      milestones: [makeMilestone({ id: "m1" })],
    });
    const shadow = projectTemarioVisibility(temario, "shadow");
    expect(shadow.topics[0]!.stars).toBe(0);
    expect(shadow.milestones).toEqual(temario.milestones);

    const visible = projectTemarioVisibility(temario, "visible");
    expect(visible.topics[0]!.stars).toBe(3);
  });
});

describe("Status and kind enumerations", () => {
  it("covers all tema statuses", () => {
    expect(TEMA_STATUSES).toEqual(["new", "studying", "done"]);
  });

  it("covers all hito kinds", () => {
    expect(HITO_KINDS).toEqual(["parcial", "examen_final"]);
  });

  it("covers all hito statuses", () => {
    expect(HITO_STATUSES).toEqual(["available", "done"]);
  });
});

describe("computeMilestoneScope (P5, DF-P05)", () => {
  it("returns [] for an unknown hitoId", () => {
    const temario = makeTemario({ topics: [makeTopic({ id: "t1", order: 0 })] });
    expect(computeMilestoneScope(temario, "does-not-exist")).toEqual([]);
  });

  it("the first milestone covers everything up to coversUpToOrder, all flagged as emphasis (no prior milestone to contrast)", () => {
    const topics = [
      makeTopic({ id: "t1", order: 0, title: "Tema 0" }),
      makeTopic({ id: "t2", order: 1, title: "Tema 1" }),
      makeTopic({ id: "t3", order: 2, title: "Tema 2" }),
    ];
    const parcial1 = makeMilestone({ id: "m1", order: 3, coversUpToOrder: 1 });
    const temario = makeTemario({ topics, milestones: [parcial1] });

    const scope = computeMilestoneScope(temario, "m1");
    expect(scope).toEqual([
      { title: "Tema 0", order: 0, emphasis: true },
      { title: "Tema 1", order: 1, emphasis: true },
    ]);
    // Tema 2 (order 2) is NOT covered — beyond this milestone's coversUpToOrder.
    expect(scope.some((s) => s.order === 2)).toBe(false);
  });

  it("a SECOND milestone covers the FULL cumulative scope but only emphasizes topics after the previous milestone's coversUpToOrder", () => {
    const topics = [
      makeTopic({ id: "t1", order: 0, title: "Tema 0" }),
      makeTopic({ id: "t2", order: 1, title: "Tema 1" }),
      makeTopic({ id: "t3", order: 2, title: "Tema 2" }),
      makeTopic({ id: "t4", order: 4, title: "Tema 4" }),
    ];
    const parcial1 = makeMilestone({ id: "m1", order: 3, coversUpToOrder: 1 });
    const parcial2 = makeMilestone({ id: "m2", order: 5, coversUpToOrder: 4 });
    const temario = makeTemario({ topics, milestones: [parcial1, parcial2] });

    const scope = computeMilestoneScope(temario, "m2");
    // DF-P05: cumulative — covers EVERYTHING up to coversUpToOrder, not just the new topics.
    expect(scope.map((s) => s.title)).toEqual(["Tema 0", "Tema 1", "Tema 2", "Tema 4"]);
    // ...but only the topics AFTER parcial1's coversUpToOrder (order 1) are emphasized.
    expect(scope.map((s) => ({ title: s.title, emphasis: s.emphasis }))).toEqual([
      { title: "Tema 0", emphasis: false },
      { title: "Tema 1", emphasis: false },
      { title: "Tema 2", emphasis: true },
      { title: "Tema 4", emphasis: true },
    ]);
  });

  it("returns topics sorted by order regardless of input order", () => {
    const topics = [
      makeTopic({ id: "t2", order: 1, title: "Tema 1" }),
      makeTopic({ id: "t1", order: 0, title: "Tema 0" }),
    ];
    const parcial = makeMilestone({ id: "m1", order: 2, coversUpToOrder: 1 });
    const temario = makeTemario({ topics, milestones: [parcial] });

    expect(computeMilestoneScope(temario, "m1").map((s) => s.title)).toEqual(["Tema 0", "Tema 1"]);
  });
});
