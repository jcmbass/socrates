import { describe, expect, it } from "vitest";
import {
  buildSkillTreeNodes,
  deriveTemarioProgress,
  deriveTopicGuidedProgress,
  formatSkillTreeCap,
  orderForBottomUpDisplay,
  orderSkillTreeNodes,
  resolveContinueTopicId,
  resolveRecommendedTopicId,
  skillTreeChrome,
} from "../skillTree";
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

describe("resolveRecommendedTopicId (DF-P02/DF-P04)", () => {
  it("returns null for an empty topic list", () => {
    expect(resolveRecommendedTopicId([])).toBeNull();
  });

  it("prefers the explicitly recommended topic even if it isn't first", () => {
    const topics = [
      fakeTopic({ id: "t1", order: 0, status: "done" }),
      fakeTopic({ id: "t2", order: 1, recommended: true }),
      fakeTopic({ id: "t3", order: 2 }),
    ];
    expect(resolveRecommendedTopicId(topics)).toBe("t2");
  });

  it("falls back to the first not-done topic in order when nothing is explicitly recommended", () => {
    const topics = [
      fakeTopic({ id: "t3", order: 2, status: "new" }),
      fakeTopic({ id: "t1", order: 0, status: "done" }),
      fakeTopic({ id: "t2", order: 1, status: "studying" }),
    ];
    expect(resolveRecommendedTopicId(topics)).toBe("t2");
  });

  it("returns null when every topic is already done", () => {
    const topics = [fakeTopic({ id: "t1", status: "done" }), fakeTopic({ id: "t2", order: 1, status: "done" })];
    expect(resolveRecommendedTopicId(topics)).toBeNull();
  });
});

describe("buildSkillTreeNodes (DF-P02 navegación libre + hitos distintos)", () => {
  it("every topic node is locked:false — no gating exists in the data", () => {
    const nodes = buildSkillTreeNodes({
      topics: [fakeTopic({ id: "t1", order: 0 }), fakeTopic({ id: "t2", order: 1 })],
      milestones: [],
    });
    expect(nodes.every((n) => n.locked === false)).toBe(true);
  });

  it("marks exactly the recommended topic among the topic nodes", () => {
    const nodes = buildSkillTreeNodes({
      topics: [fakeTopic({ id: "t1", order: 0, status: "done" }), fakeTopic({ id: "t2", order: 1 })],
      milestones: [],
    });
    const topicNodes = nodes.filter((n) => n.kind === "topic");
    expect(topicNodes.find((n) => n.id === "t2")?.recommended).toBe(true);
    expect(topicNodes.find((n) => n.id === "t1")?.recommended).toBe(false);
  });

  it("passes stars through unchanged (0-3)", () => {
    const nodes = buildSkillTreeNodes({ topics: [fakeTopic({ id: "t1", stars: 2 })], milestones: [] });
    const topicNode = nodes.find((n) => n.kind === "topic");
    expect(topicNode).toMatchObject({ stars: 2 });
  });

  it("milestones are a visually distinct node kind, interleaved by order", () => {
    const nodes = buildSkillTreeNodes({
      topics: [fakeTopic({ id: "t1", order: 0 }), fakeTopic({ id: "t2", order: 2 })],
      milestones: [fakeMilestone({ id: "m1", order: 1 })],
    });
    expect(nodes.map((n) => n.kind)).toEqual(["topic", "milestone", "topic"]);
    expect(nodes.map((n) => n.id)).toEqual(["t1", "m1", "t2"]);
  });

  it("milestone nodes are also locked:false — hitos never gate (DF-P05)", () => {
    const nodes = buildSkillTreeNodes({ topics: [], milestones: [fakeMilestone()] });
    expect(nodes[0]).toMatchObject({ locked: false, kind: "milestone" });
  });

  describe("W3 fix: interleave by coversUpToOrder, not by the milestone's own (append-only) order", () => {
    it("a milestone with coversUpToOrder=3 lands after the order=3 topic and before order=4", () => {
      // The server always APPENDS a new milestone (its `order` keeps
      // incrementing past every topic) — order:99 here reproduces that
      // real shape, so a naive sort-by-raw-order would push it to the end
      // instead of right after topic order=3.
      const nodes = buildSkillTreeNodes({
        topics: [
          fakeTopic({ id: "t1", order: 1 }),
          fakeTopic({ id: "t2", order: 2 }),
          fakeTopic({ id: "t3", order: 3 }),
          fakeTopic({ id: "t4", order: 4 }),
          fakeTopic({ id: "t5", order: 5 }),
        ],
        milestones: [fakeMilestone({ id: "m1", order: 99, coversUpToOrder: 3 })],
      });
      expect(nodes.map((n) => n.id)).toEqual(["t1", "t2", "t3", "m1", "t4", "t5"]);
    });

    it("still no locked:true anywhere once milestones are interleaved", () => {
      const nodes = buildSkillTreeNodes({
        topics: [fakeTopic({ id: "t1", order: 0 }), fakeTopic({ id: "t2", order: 1 }), fakeTopic({ id: "t3", order: 2 })],
        milestones: [fakeMilestone({ id: "m1", order: 50, coversUpToOrder: 0 }), fakeMilestone({ id: "m2", order: 51, coversUpToOrder: 2 })],
      });
      expect(nodes.every((n) => n.locked === false)).toBe(true);
      expect(nodes.map((n) => n.id)).toEqual(["t1", "m1", "t2", "t3", "m2"]);
    });

    it("two milestones covering the same topic order break the tie on their own raw order", () => {
      const nodes = buildSkillTreeNodes({
        topics: [fakeTopic({ id: "t1", order: 0 }), fakeTopic({ id: "t2", order: 1 })],
        milestones: [fakeMilestone({ id: "later", order: 60, coversUpToOrder: 0 }), fakeMilestone({ id: "earlier", order: 40, coversUpToOrder: 0 })],
      });
      expect(nodes.map((n) => n.id)).toEqual(["t1", "earlier", "later", "t2"]);
    });
  });
});

describe("deriveTemarioProgress", () => {
  it("counts done topics over the total and rounds the percent", () => {
    const topics = [
      fakeTopic({ id: "t1", status: "done" }),
      fakeTopic({ id: "t2", status: "done" }),
      fakeTopic({ id: "t3", status: "studying" }),
    ];
    expect(deriveTemarioProgress(topics)).toEqual({ doneCount: 2, total: 3, percent: 67 });
  });

  it("never divides by zero — an empty topic list is 0/0/0%", () => {
    expect(deriveTemarioProgress([])).toEqual({ doneCount: 0, total: 0, percent: 0 });
  });

  it("ignores milestones entirely — only Tema.status counts", () => {
    const topics = [fakeTopic({ id: "t1", status: "new" })];
    expect(deriveTemarioProgress(topics)).toEqual({ doneCount: 0, total: 1, percent: 0 });
  });
});

describe("orderForBottomUpDisplay", () => {
  it("reverses temario order so the highest order renders first (top of screen = 'por venir')", () => {
    const nodes = buildSkillTreeNodes({
      topics: [fakeTopic({ id: "t1", order: 0 }), fakeTopic({ id: "t2", order: 1 }), fakeTopic({ id: "t3", order: 2 })],
      milestones: [],
    });
    const display = orderForBottomUpDisplay(nodes);
    expect(display.map((n) => n.id)).toEqual(["t3", "t2", "t1"]);
  });

  it("does not mutate the input array", () => {
    const nodes = buildSkillTreeNodes({ topics: [fakeTopic({ id: "t1" })], milestones: [] });
    const copy = [...nodes];
    orderForBottomUpDisplay(nodes);
    expect(nodes).toEqual(copy);
  });
});

describe("orderSkillTreeNodes", () => {
  const nodes = buildSkillTreeNodes({
    topics: [
      fakeTopic({ id: "topic-3", order: 3 }),
      fakeTopic({ id: "topic-1", order: 1 }),
      fakeTopic({ id: "topic-2", order: 2 }),
    ],
    milestones: [],
  });

  it("renders grouped syllabus chapters top-down", () => {
    expect(orderSkillTreeNodes(nodes, "syllabus").map((node) => node.id)).toEqual([
      "topic-1",
      "topic-2",
      "topic-3",
    ]);
  });

  it("preserves bottom-up ordering for the flat game map", () => {
    expect(orderSkillTreeNodes(nodes, "gameMap").map((node) => node.id)).toEqual([
      "topic-3",
      "topic-2",
      "topic-1",
    ]);
  });

  it("never mutates the built node list", () => {
    const before = nodes.map((node) => node.id);
    orderSkillTreeNodes(nodes, "syllabus");
    orderSkillTreeNodes(nodes, "gameMap");
    expect(nodes.map((node) => node.id)).toEqual(before);
  });
});

describe("skillTreeChrome", () => {
  const copy = {
    start: "INICIO DEL TEMARIO",
    advancedUp: "Los temas avanzados aparecen arriba",
    advancedDown: "Los temas avanzados aparecen abajo",
  };

  it("places the start cap on top for syllabus and never uses a bottom-up up-arrow", () => {
    const chrome = skillTreeChrome("syllabus");
    expect(formatSkillTreeCap(chrome.top, copy)).toBe("INICIO DEL TEMARIO");
    expect(formatSkillTreeCap(chrome.bottom, copy)).toBe("↓ Los temas avanzados aparecen abajo");
    expect(formatSkillTreeCap(chrome.top, copy)).not.toMatch(/↑/);
    expect(chrome.top.arrow).toBeNull();
  });

  it("keeps bottom-up chrome on the flat game map", () => {
    const chrome = skillTreeChrome("gameMap");
    expect(formatSkillTreeCap(chrome.top, copy)).toBe("↑ Los temas avanzados aparecen arriba");
    expect(formatSkillTreeCap(chrome.bottom, copy)).toBe("INICIO DEL TEMARIO");
  });
});

describe("deriveTopicGuidedProgress (hallazgo C)", () => {
  it("is null when the field is missing or total is 0", () => {
    expect(deriveTopicGuidedProgress(undefined)).toBeNull();
    expect(deriveTopicGuidedProgress({ completed: 0, total: 0 })).toBeNull();
  });

  it("returns completed/total and a rounded percent", () => {
    expect(deriveTopicGuidedProgress({ completed: 3, total: 10 })).toEqual({ completed: 3, total: 10, percent: 30 });
    expect(deriveTopicGuidedProgress({ completed: 1, total: 3 })).toEqual({ completed: 1, total: 3, percent: 33 });
  });

  it("clamps completed into [0, total]", () => {
    expect(deriveTopicGuidedProgress({ completed: 12, total: 10 })).toEqual({ completed: 10, total: 10, percent: 100 });
    expect(deriveTopicGuidedProgress({ completed: -1, total: 10 })).toEqual({ completed: 0, total: 10, percent: 0 });
  });

  it("is carried on topic nodes by buildSkillTreeNodes", () => {
    const nodes = buildSkillTreeNodes({
      topics: [fakeTopic({ id: "t1", guidedProgress: { completed: 3, total: 10 } }), fakeTopic({ id: "t2", order: 1 })],
      milestones: [],
    });
    expect(nodes[0]).toMatchObject({ kind: "topic", guidedProgress: { completed: 3, total: 10, percent: 30 } });
    expect(nodes[1]).toMatchObject({ kind: "topic", guidedProgress: null });
  });
});

describe("resolveContinueTopicId (hallazgo C)", () => {
  const full = { completed: 10, total: 10 };

  it("keeps the recommended topic when it is not guided-complete", () => {
    const topics = [fakeTopic({ id: "t1", guidedProgress: { completed: 3, total: 10 } }), fakeTopic({ id: "t2", order: 1 })];
    expect(resolveContinueTopicId(topics, "t1")).toBe("t1");
  });

  it("keeps the recommended topic when it has no guided progress", () => {
    const topics = [fakeTopic({ id: "t1" }), fakeTopic({ id: "t2", order: 1 })];
    expect(resolveContinueTopicId(topics, "t1")).toBe("t1");
  });

  it("moves to the next syllabus topic that is neither done nor guided-complete", () => {
    const topics = [
      fakeTopic({ id: "t1", guidedProgress: full }),
      fakeTopic({ id: "t2", order: 1, status: "done" }),
      fakeTopic({ id: "t3", order: 2, guidedProgress: full }),
      fakeTopic({ id: "t4", order: 3, guidedProgress: { completed: 2, total: 10 } }),
    ];
    expect(resolveContinueTopicId(topics, "t1")).toBe("t4");
  });

  it("wraps around to earlier topics", () => {
    const topics = [fakeTopic({ id: "t1" }), fakeTopic({ id: "t2", order: 1, guidedProgress: full })];
    expect(resolveContinueTopicId(topics, "t2")).toBe("t1");
  });

  it("falls back to the recommended topic when every topic is complete", () => {
    const topics = [fakeTopic({ id: "t1", guidedProgress: full }), fakeTopic({ id: "t2", order: 1, status: "done" })];
    expect(resolveContinueTopicId(topics, "t1")).toBe("t1");
  });

  it("is null when there is no recommended topic", () => {
    expect(resolveContinueTopicId([fakeTopic({ status: "done" })], null)).toBeNull();
  });
});
