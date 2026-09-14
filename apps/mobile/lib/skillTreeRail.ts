/**
 * SkillTree rail geometry — pure, React-free logic for the zigzag skill-tree
 * connectors. Lives outside the RN runtime so it can be tested under vitest.
 *
 * The geometry is deterministic: once you know the node list and the fixed
 * `pitch`, every y coordinate is fixed. No `onLayout`, no per-node measurement.
 * `BASE_PITCH` scales with the system font setting (`PixelRatio.getFontScale()`
 * in the component), so the fixed row still fits when the user has large fonts.
 *
 * Coordinate convention used by the exported path builders:
 * - x = 0 is the horizontal center of the rail. Callers translate the whole
 *   path by the actual center of the tree container.
 * - y = 0 is the top of the first row; y grows downward.
 */
import { spacing, typography, MIN_TOUCH_TARGET } from "../theme/tokens";
import type { SkillTreeNode } from "./skillTree";

const NODE_SIZE = MIN_TOUCH_TARGET; // 48
/** Recommended node diameter. Exported for tests that verify glow-ring sync. */
export const RECOMMENDED_NODE_SIZE = MIN_TOUCH_TARGET + 20; // 68
/** Glow ring expansion (dp) applied around the recommended node. Must stay in
 * sync with `GLOW_EXTRA` in `components/SkillTree.tsx`. */
export const GLOW_EXTRA = 20;

const MILESTONE_VISUAL_SCALE = 0.7; // diamond side length relative to NODE_SIZE

/** Vertical/horizontal gap between a node's visual edge and the rail stroke. */
export const RAIL_GAP = spacing.sm; // 8

/** Horizontal offset of topic nodes from the rail center, toward their card side.
 * Hitos stay centered at x = 0. */
export const NODE_OFFSET = 20;

/**
 * Base row pitch in dp. Derived from the tallest visual node (recommended with
 * glow) and the tallest possible truncated card, plus double gap and a small
 * slack so the card never bleeds out of its fixed slot when fonts scale.
 */
const MAX_NODE_DIAMETER = RECOMMENDED_NODE_SIZE + GLOW_EXTRA; // 88
const CARD_ESTIMATED_HEIGHT =
  spacing.sm * 2 + // vertical padding
  spacing.xs * 2 + // gaps between up to three children
  Math.max(typography.caption.lineHeight, typography.eyebrow.lineHeight) + // top label
  typography.small.lineHeight * 2 + // title truncated to 2 lines
  typography.caption.lineHeight; // completed / status row

export const BASE_PITCH = Math.max(MAX_NODE_DIAMETER, CARD_ESTIMATED_HEIGHT) + RAIL_GAP * 2 + spacing.sm; // ≈128

/** Visual radius of a node for rail calculations (not the same as its touch box). */
export function visualNodeRadius(node: SkillTreeNode): number {
  if (node.kind === "milestone") return (NODE_SIZE * MILESTONE_VISUAL_SCALE) / 2; // ≈ 17
  if (node.recommended) return (RECOMMENDED_NODE_SIZE + GLOW_EXTRA) / 2; // 44 (includes glow)
  return NODE_SIZE / 2; // 24
}

export interface RailPoint {
  x: number;
  y: number;
}

export interface RailSegment {
  from: RailPoint;
  to: RailPoint;
  fromIndex: number;
  toIndex: number;
  fromNode: SkillTreeNode;
  toNode: SkillTreeNode;
}

/**
 * Vertical center of row `index`, relative to the top of the first row.
 * Single source of truth for the row geometry: the rail path builders below
 * and `SkillTree`'s autoscroll reporting (`onRecommendedCenterY`) both go
 * through here, so the pitch math can never drift between the two.
 */
export function nodeCenterY(index: number, pitch: number): number {
  return index * pitch + pitch / 2;
}

/** Horizontal center of a node, relative to the rail center.
 *  - Milestones stay on the rail center (a milestone covers the whole path so
 *    far, not one side).
 *  - Recommended topic also stays centered so its glow ring does not overflow
 *    into the adjacent card.
 *  - Other topics shift toward their card side so the curve visibly connects
 *    the node to its label.
 */
export function nodeX(index: number, node: SkillTreeNode): number {
  if (node.kind === "milestone") return 0;
  if (node.recommended) return 0;
  return sideForIndex(index) === "left" ? -NODE_OFFSET : NODE_OFFSET;
}

/**
 * Build every rail segment for the given nodes in display order. Each segment
 * starts `RAIL_GAP` below the upper node and ends `RAIL_GAP` above the lower
 * node, using the per-node visual radius and its horizontal offset.
 */
export function buildRailGeometry(nodes: readonly SkillTreeNode[], pitch: number): { segments: RailSegment[]; totalHeight: number } {
  const segments: RailSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const fromNode = nodes[i];
    const toNode = nodes[i + 1];
    const r0 = visualNodeRadius(fromNode);
    const r1 = visualNodeRadius(toNode);
    const from: RailPoint = { x: nodeX(i, fromNode), y: nodeCenterY(i, pitch) + r0 + RAIL_GAP };
    const to: RailPoint = { x: nodeX(i + 1, toNode), y: nodeCenterY(i + 1, pitch) - r1 - RAIL_GAP };
    if (to.y > from.y) {
      segments.push({ from, to, fromIndex: i, toIndex: i + 1, fromNode, toNode });
    }
  }
  const totalHeight = nodes.length * pitch;
  return { segments, totalHeight };
}

/** Which side the card sits on for display index `i`. */
export function sideForIndex(index: number): "left" | "right" {
  return index % 2 === 0 ? "left" : "right";
}

/**
 * Cubic bezier version of a segment with vertical tangents at both ends.
 * The control points share the x of their endpoint and sit halfway along the
 * vertical gap, so the stroke leaves the upper node pointing straight down
 * and enters the lower node pointing straight up. Topic nodes are offset
 * toward their card side (except the recommended one, whose glow must stay
 * inside the rail); milestones stay centered.
 */
export function bezierSegmentD(segment: RailSegment): string {
  const dy = segment.to.y - segment.from.y;
  const cp1: RailPoint = { x: segment.from.x, y: segment.from.y + dy * 0.5 };
  const cp2: RailPoint = { x: segment.to.x, y: segment.to.y - dy * 0.5 };
  return `M ${segment.from.x},${segment.from.y} C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${segment.to.x},${segment.to.y}`;
}

/**
 * Split rail segments by endpoint status, independent of display direction.
 * Every done↔pending transition is kept in `boundaries` (DF-P02 allows
 * completing topics out of order, so `done/new/done` is a real sequence).
 */
export function splitRailByStatus(segments: readonly RailSegment[]): {
  done: RailSegment[];
  pending: RailSegment[];
  boundaries: RailSegment[];
} {
  return {
    done: segments.filter((s) => s.fromNode.status === "done" && s.toNode.status === "done"),
    pending: segments.filter((s) => s.fromNode.status !== "done" && s.toNode.status !== "done"),
    boundaries: segments.filter((s) => (s.fromNode.status === "done") !== (s.toNode.status === "done")),
  };
}
