import { describe, expect, it } from "vitest";
import {
  buildRailGeometry,
  nodeX,
  sideForIndex,
  splitRailByStatus,
  visualNodeRadius,
  BASE_PITCH,
  GLOW_EXTRA,
  NODE_OFFSET,
  RAIL_GAP,
  RECOMMENDED_NODE_SIZE,
} from "../skillTreeRail";
import type { SkillTreeNode } from "../skillTree";

function topic(overrides: Partial<SkillTreeNode> & { kind?: "topic" } = {}): SkillTreeNode {
  return {
    kind: "topic",
    id: "t-default",
    order: 0,
    title: "Tema genérico",
    status: "new",
    stars: 0,
    recommended: false,
    locked: false,
    ...overrides,
  } as SkillTreeNode;
}

function milestone(overrides: Partial<SkillTreeNode> & { kind?: "milestone" } = {}): SkillTreeNode {
  return {
    kind: "milestone",
    id: "m-default",
    order: 1,
    title: "Parcial genérico",
    milestoneKind: "parcial",
    coversUpToOrder: 0,
    status: "available",
    locked: false,
    ...overrides,
  } as SkillTreeNode;
}

/** Parse a cubic bezier path string `M x,y C x1,y1 x2,y2 x,y` into its points. */
function parseBezierD(d: string) {
  const match = d.match(/^M\s*([\d\-.]+),\s*([\d\-.]+)\s+C\s*([\d\-.]+),\s*([\d\-.]+)\s+([\d\-.]+),\s*([\d\-.]+)\s+([\d\-.]+),\s*([\d\-.]+)$/);
  if (!match) throw new Error(`Unexpected path format: ${d}`);
  return {
    from: { x: Number(match[1]), y: Number(match[2]) },
    cp1: { x: Number(match[3]), y: Number(match[4]) },
    cp2: { x: Number(match[5]), y: Number(match[6]) },
    to: { x: Number(match[7]), y: Number(match[8]) },
  };
}

describe("visualNodeRadius", () => {
  it("normal topic has radius NODE_SIZE/2", () => {
    expect(visualNodeRadius(topic())).toBe(24);
  });

  it("recommended topic includes the glow ring", () => {
    expect(visualNodeRadius(topic({ recommended: true }))).toBe((68 + 20) / 2);
  });

  it("milestone diamond uses scaled NODE_SIZE/2", () => {
    expect(visualNodeRadius(milestone())).toBe((48 * 0.7) / 2);
  });
});

describe("nodeX", () => {
  it("offsets normal topic nodes toward their card side", () => {
    expect(nodeX(0, topic())).toBe(-NODE_OFFSET);
    expect(nodeX(1, topic())).toBe(NODE_OFFSET);
    expect(nodeX(2, topic())).toBe(-NODE_OFFSET);
  });

  it("keeps the recommended topic centered so its glow ring fits inside the rail", () => {
    expect(nodeX(0, topic({ recommended: true }))).toBe(0);
    expect(nodeX(1, topic({ recommended: true }))).toBe(0);
  });

  it("keeps milestones centered on the rail", () => {
    expect(nodeX(0, milestone())).toBe(0);
    expect(nodeX(1, milestone())).toBe(0);
  });
});

describe("sideForIndex", () => {
  it("alternates left/right starting with left", () => {
    expect(sideForIndex(0)).toBe("left");
    expect(sideForIndex(1)).toBe("right");
    expect(sideForIndex(2)).toBe("left");
  });
});

describe("buildRailGeometry", () => {
  it("a single node produces no segments", () => {
    const { segments, totalHeight } = buildRailGeometry([topic()], BASE_PITCH);
    expect(segments).toHaveLength(0);
    expect(totalHeight).toBe(BASE_PITCH);
  });

  it("two topic nodes produce a segment with x offset toward each card side", () => {
    const nodes = [topic({ id: "t1", order: 1 }), topic({ id: "t0", order: 0, status: "done" })];
    const { segments, totalHeight } = buildRailGeometry(nodes, BASE_PITCH);
    expect(segments).toHaveLength(1);

    const cy0 = BASE_PITCH / 2;
    const cy1 = BASE_PITCH + BASE_PITCH / 2;
    expect(segments[0].from).toEqual({ x: -NODE_OFFSET, y: cy0 + 24 + RAIL_GAP });
    expect(segments[0].to).toEqual({ x: NODE_OFFSET, y: cy1 - 24 - RAIL_GAP });
    expect(totalHeight).toBe(2 * BASE_PITCH);
  });

  it("recommended node uses glow radius so the rail stops outside the halo", () => {
    const nodes = [topic({ id: "t1", order: 1, recommended: true }), topic({ id: "t0", order: 0 })];
    const { segments } = buildRailGeometry(nodes, BASE_PITCH);
    const cy0 = BASE_PITCH / 2;
    expect(segments[0].from.y).toBe(cy0 + (68 + 20) / 2 + RAIL_GAP);
  });

  it("milestones stay centered while topics offset, preserving equal vertical gaps", () => {
    const nodes: SkillTreeNode[] = [
      topic({ id: "t3", order: 3, recommended: true }),
      milestone({ id: "m2", order: 4, coversUpToOrder: 2 }),
      topic({ id: "t2", order: 2 }),
      topic({ id: "t1", order: 1, status: "done" }),
      topic({ id: "t0", order: 0, recommended: true }),
    ];
    const { segments } = buildRailGeometry(nodes, BASE_PITCH);
    expect(segments.length).toBe(nodes.length - 1);

    for (let i = 0; i < segments.length; i++) {
      const fromCenter = i * BASE_PITCH + BASE_PITCH / 2;
      const toCenter = (i + 1) * BASE_PITCH + BASE_PITCH / 2;
      const r0 = visualNodeRadius(nodes[i]);
      const r1 = visualNodeRadius(nodes[i + 1]);
      expect(segments[i].from.y - (fromCenter + r0)).toBe(RAIL_GAP);
      expect(toCenter - r1 - segments[i].to.y).toBe(RAIL_GAP);
    }

    // Milestone centers:
    expect(segments[0].to.x).toBe(0);
    expect(segments[1].from.x).toBe(0);
  });
});

describe("splitRailByStatus", () => {
  it("places pending segments above the boundary and done segments below it", () => {
    // Display order: index 0 is top of screen (last temario order), last index is bottom (first order).
    const nodes: SkillTreeNode[] = [
      topic({ id: "t3", order: 3, status: "new" }),
      topic({ id: "t2", order: 2, status: "new" }),
      topic({ id: "t1", order: 1, status: "done" }),
      topic({ id: "t0", order: 0, status: "done" }),
    ];
    const { segments } = buildRailGeometry(nodes, BASE_PITCH);
    const { done, pending, boundaries } = splitRailByStatus(segments);

    // 4 nodes → 3 segments. Boundary is the single pending->done transition.
    expect(segments).toHaveLength(3);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].fromNode.id).toBe("t2");
    expect(boundaries[0].toNode.id).toBe("t1");

    // Pending segments are above the boundary (lower y indices).
    expect(pending).toHaveLength(1);
    expect(pending[0].fromNode.id).toBe("t3");
    expect(pending[0].toNode.id).toBe("t2");

    // Done segments are below the boundary (higher y indices).
    expect(done).toHaveLength(1);
    expect(done[0].fromNode.id).toBe("t1");
    expect(done[0].toNode.id).toBe("t0");
  });

  it("returns no boundary when all nodes share the same status", () => {
    const allDone: SkillTreeNode[] = [
      topic({ id: "t2", order: 2, status: "done" }),
      topic({ id: "t1", order: 1, status: "done" }),
      topic({ id: "t0", order: 0, status: "done" }),
    ];
    const { segments } = buildRailGeometry(allDone, BASE_PITCH);
    const { done, pending, boundaries } = splitRailByStatus(segments);
    expect(boundaries).toEqual([]);
    expect(done).toHaveLength(2);
    expect(pending).toHaveLength(0);
  });

  it("handles a skipped topic (done above, pending below) without crashing", () => {
    const nodes: SkillTreeNode[] = [
      topic({ id: "t3", order: 3, status: "done" }),
      topic({ id: "t2", order: 2, status: "done" }),
      topic({ id: "t1", order: 1, status: "new" }),
      topic({ id: "t0", order: 0, status: "new" }),
    ];
    const { segments } = buildRailGeometry(nodes, BASE_PITCH);
    const { done, pending, boundaries } = splitRailByStatus(segments);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].fromNode.id).toBe("t2");
    expect(boundaries[0].toNode.id).toBe("t1");
    expect(done).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });

  it("colors segments correctly in top-down syllabus order", () => {
    const nodes: SkillTreeNode[] = [
      topic({ id: "t0", order: 0, status: "done" }),
      topic({ id: "t1", order: 1, status: "done" }),
      topic({ id: "t2", order: 2, status: "new" }),
      topic({ id: "t3", order: 3, status: "new" }),
    ];
    const { segments } = buildRailGeometry(nodes, BASE_PITCH);
    const { done, pending, boundaries } = splitRailByStatus(segments);

    expect(done.map((segment) => [segment.fromNode.id, segment.toNode.id])).toEqual([["t0", "t1"]]);
    expect(pending.map((segment) => [segment.fromNode.id, segment.toNode.id])).toEqual([["t2", "t3"]]);
    expect(boundaries.map((segment) => [segment.fromNode.id, segment.toNode.id])).toEqual([["t1", "t2"]]);
  });

  it("keeps every mixed segment in a done/new/done sequence", () => {
    const nodes: SkillTreeNode[] = [
      topic({ id: "t0", order: 0, status: "done" }),
      topic({ id: "t1", order: 1, status: "new" }),
      topic({ id: "t2", order: 2, status: "done" }),
      topic({ id: "t3", order: 3, status: "new" }),
    ];
    const { segments } = buildRailGeometry(nodes, BASE_PITCH);
    const { done, pending, boundaries } = splitRailByStatus(segments);

    expect(done).toEqual([]);
    expect(pending).toEqual([]);
    expect(boundaries.map((segment) => [segment.fromNode.id, segment.toNode.id])).toEqual([
      ["t0", "t1"],
      ["t1", "t2"],
      ["t2", "t3"],
    ]);
  });
});

import { bezierSegmentD as bezierSegmentDImpl } from "../skillTreeRail";

describe("glow ring synchronization", () => {
  it("recommended visual radius matches GlowRing size + GLOW_EXTRA / 2", () => {
    // GlowRing draws at size + GLOW_EXTRA; visualNodeRadius must agree so the
    // rail stops exactly RAIL_GAP outside the halo and the ring never clips the
    // card. This test prevents the two files from drifting apart.
    const recommendedTopic = topic({ recommended: true });
    const glowDrawSize = RECOMMENDED_NODE_SIZE + GLOW_EXTRA;
    expect(visualNodeRadius(recommendedTopic)).toBe(glowDrawSize / 2);
  });
});

describe("bezierSegmentD tangent invariants", () => {
  it("control points share the x of their endpoint, forcing vertical tangents", () => {
    const nodes: SkillTreeNode[] = [
      topic({ id: "t1", order: 1 }),
      milestone({ id: "m0", order: 0 }),
      topic({ id: "t2", order: 2 }),
    ];
    const { segments } = buildRailGeometry(nodes, BASE_PITCH);
    for (const segment of segments) {
      const single = parseBezierD(bezierSegmentDImpl(segment));
      expect(single.cp1.x).toBe(single.from.x);
      expect(single.cp2.x).toBe(single.to.x);
    }
  });

  it("curves pass through the midpoint of the vertical span", () => {
    const segment = buildRailGeometry([topic({ id: "a" }), topic({ id: "b" })], BASE_PITCH).segments[0];
    const parsed = parseBezierD(bezierSegmentDImpl(segment));
    const midY = (parsed.from.y + parsed.to.y) / 2;
    expect(parsed.cp1.y).toBe(midY);
    expect(parsed.cp2.y).toBe(midY);
  });
});
