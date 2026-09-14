import { describe, expect, it } from "vitest";
import { findUnitGroupForTopic, groupTopicsByUnit, seedLevelFromCatalogKey } from "../temarioGroups";
import type { Hito, Tema } from "../api/types";

function fakeTopic(overrides: Partial<Tema> = {}): Tema {
  return {
    id: "t1",
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

function fakeMilestone(overrides: Partial<Hito> = {}): Hito {
  return {
    id: "m1",
    temarioId: "temario-1",
    order: 1,
    kind: "parcial",
    title: "Primer parcial",
    coversUpToOrder: 0,
    status: "available",
    schemaVersion: 1,
    ...overrides,
  };
}

/** 206 topics distributed across 47 units, contiguous by `order` — the
 * real shape `universidad/biologia` (es) ships (see seed-subjects.test.ts). */
function makeRealisticSeedTopics(): Tema[] {
  const UNIT_COUNT = 47;
  const TOTAL_TOPICS = 206;
  const base = Math.floor(TOTAL_TOPICS / UNIT_COUNT); // 4
  const extra = TOTAL_TOPICS - base * UNIT_COUNT; // 18 units get one more
  const topics: Tema[] = [];
  let order = 0;
  for (let unitIndex = 0; unitIndex < UNIT_COUNT; unitIndex++) {
    const count = unitIndex < extra ? base + 1 : base;
    for (let i = 0; i < count; i++) {
      topics.push(fakeTopic({ id: `t${order}`, order, unitLabel: `Unidad ${unitIndex + 1}`, status: "new" }));
      order++;
    }
  }
  return topics;
}

describe("groupTopicsByUnit (C2-d)", () => {
  it("returns null for an empty topic list", () => {
    expect(groupTopicsByUnit({ topics: [], milestones: [] })).toBeNull();
  });

  it("returns null when EVERY topic's unitLabel is null (student's own subject — flat rendering, zero regression)", () => {
    const topics = [fakeTopic({ id: "t1", order: 0 }), fakeTopic({ id: "t2", order: 1 })];
    expect(groupTopicsByUnit({ topics, milestones: [] })).toBeNull();
  });

  it("groups 206 realistic topics into exactly 47 units, preserving order and per-unit counts", () => {
    const topics = makeRealisticSeedTopics();
    const groups = groupTopicsByUnit({ topics, milestones: [] });
    expect(groups).not.toBeNull();
    expect(groups).toHaveLength(47);
    expect(groups!.reduce((sum, g) => sum + g.total, 0)).toBe(206);
    expect(groups!.map((g) => g.unitLabel)).toEqual(Array.from({ length: 47 }, (_, i) => `Unidad ${i + 1}`));
    // First-appearance order preserved and topics stay inside their own unit.
    for (const group of groups!) {
      expect(group.topics.every((t) => t.unitLabel === group.unitLabel)).toBe(true);
      expect(group.total).toBe(group.topics.length);
    }
  });

  it("a mix of topics with and without a unit produces a distinct null-labeled bucket, never merged into a named unit", () => {
    const topics = [
      fakeTopic({ id: "t1", order: 0, unitLabel: "Unidad 1" }),
      fakeTopic({ id: "t2", order: 1, unitLabel: null }),
      fakeTopic({ id: "t3", order: 2, unitLabel: "Unidad 1" }),
      fakeTopic({ id: "t4", order: 3, unitLabel: null }),
      fakeTopic({ id: "t5", order: 4, unitLabel: "Unidad 2" }),
    ];
    const groups = groupTopicsByUnit({ topics, milestones: [] });
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => g.unitLabel)).toEqual(["Unidad 1", null, "Unidad 2"]);
    expect(groups!.find((g) => g.unitLabel === null)!.topics.map((t) => t.id)).toEqual(["t2", "t4"]);
    expect(groups!.find((g) => g.unitLabel === "Unidad 1")!.topics.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("computes doneCount/total per unit (for the section header progress, e.g. '3/8')", () => {
    const topics = [
      fakeTopic({ id: "t1", order: 0, unitLabel: "Unidad 1", status: "done" }),
      fakeTopic({ id: "t2", order: 1, unitLabel: "Unidad 1", status: "done" }),
      fakeTopic({ id: "t3", order: 2, unitLabel: "Unidad 1", status: "new" }),
      fakeTopic({ id: "t4", order: 3, unitLabel: "Unidad 2", status: "new" }),
    ];
    const groups = groupTopicsByUnit({ topics, milestones: [] })!;
    expect(groups.find((g) => g.unitLabel === "Unidad 1")).toMatchObject({ doneCount: 2, total: 3 });
    expect(groups.find((g) => g.unitLabel === "Unidad 2")).toMatchObject({ doneCount: 0, total: 1 });
  });

  it("assigns a milestone to the group of the LAST topic it covers", () => {
    const topics = [
      fakeTopic({ id: "t1", order: 0, unitLabel: "Unidad 1" }),
      fakeTopic({ id: "t2", order: 1, unitLabel: "Unidad 1" }),
      fakeTopic({ id: "t3", order: 2, unitLabel: "Unidad 2" }),
      fakeTopic({ id: "t4", order: 3, unitLabel: "Unidad 2" }),
    ];
    const milestones = [fakeMilestone({ id: "m1", coversUpToOrder: 1 }), fakeMilestone({ id: "m2", coversUpToOrder: 3 })];
    const groups = groupTopicsByUnit({ topics, milestones })!;
    expect(groups.find((g) => g.unitLabel === "Unidad 1")!.milestones.map((m) => m.id)).toEqual(["m1"]);
    expect(groups.find((g) => g.unitLabel === "Unidad 2")!.milestones.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("findUnitGroupForTopic (which section starts expanded)", () => {
  it("finds the unit containing the given (globally-recommended) topic id", () => {
    const topics = makeRealisticSeedTopics();
    const groups = groupTopicsByUnit({ topics, milestones: [] })!;
    // The 5th topic overall (t4, 0-based) lives in "Unidad 2" given the
    // realistic distribution (18 units of 5, then 4 each) — assert via the
    // group's own membership instead of hardcoding the unit boundary math.
    const owningGroup = groups.find((g) => g.topics.some((t) => t.id === "t4"))!;
    expect(findUnitGroupForTopic(groups, "t4")).toBe(owningGroup);
  });

  it("returns null when the topic id isn't in any group", () => {
    const topics = [fakeTopic({ id: "t1", order: 0, unitLabel: "Unidad 1" })];
    const groups = groupTopicsByUnit({ topics, milestones: [] })!;
    expect(findUnitGroupForTopic(groups, "does-not-exist")).toBeNull();
  });
});

describe("seedLevelFromCatalogKey (header caption, C2-d requirement #2)", () => {
  it("derives the level from a real seedCatalogKey", () => {
    expect(seedLevelFromCatalogKey("universidad/biologia")).toBe("universidad");
    expect(seedLevelFromCatalogKey("bachillerato/fisica")).toBe("bachillerato");
  });

  it("returns null for a student's own subject (seedCatalogKey null)", () => {
    expect(seedLevelFromCatalogKey(null)).toBeNull();
  });

  it("returns null for an unrecognized prefix instead of throwing", () => {
    expect(seedLevelFromCatalogKey("posgrado/quimica")).toBeNull();
    expect(seedLevelFromCatalogKey("")).toBeNull();
  });
});
