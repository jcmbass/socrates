/**
 * SkillTree (P4) — pure logic backing `components/SkillTree.tsx`, factored
 * out for the same reason `lib/homeCards.ts` and P3's `lib/onboard*.ts`
 * were: the component itself imports react-native and sits outside
 * `vitest.config.ts`'s test surface.
 *
 * **DF-P02 (navigación libre) is encoded in the data, not just the UI:**
 * every node this module produces carries `locked: false` as a literal —
 * there is no branch anywhere here that can set it `true`. That makes "no
 * topic is ever locked" a property a test can assert directly on the data,
 * rather than only on how a component happens to render it today.
 *
 * `Tema.recommended`/`stars` are read straight from the domain object
 * (`@buxo/domain/temario`) — the server already gates `stars` through
 * `projectTemarioVisibility` (P4), so whatever this module receives is
 * already antifuga-safe; it does no visibility logic of its own.
 */
import type { GuidedProgress, Hito, Tema, Temario } from "./api/types";

/** Intra-topic guided progress ready to render ("3/10 · 30%"). */
export interface TopicGuidedProgress {
  completed: number;
  total: number;
  /** 0-100, rounded. */
  percent: number;
}

/**
 * `null` when the topic has no generated items (field omitted or
 * `total <= 0`) — the card then shows no fraction at all. `completed` is
 * clamped to `[0, total]` so a stale payload never renders "11/10" or 110%.
 */
export function deriveTopicGuidedProgress(progress: GuidedProgress | undefined): TopicGuidedProgress | null {
  if (!progress || !(progress.total > 0)) return null;
  const completed = Math.min(Math.max(progress.completed, 0), progress.total);
  return { completed, total: progress.total, percent: Math.round((completed / progress.total) * 100) };
}

function isGuidedComplete(topic: Tema): boolean {
  const progress = deriveTopicGuidedProgress(topic.guidedProgress);
  return progress !== null && progress.completed >= progress.total;
}

/**
 * Target of the syllabus "Continue" button. Keeps `recommendedId` unless
 * that topic's guided items are all answered — then it moves to the next
 * topic in syllabus order (wrapping around) that is neither `done` nor
 * guided-complete. Falls back to `recommendedId` when no such topic exists.
 * Never mutates status: a guided-complete topic is still not `done`.
 */
export function resolveContinueTopicId(topics: readonly Tema[], recommendedId: string | null): string | null {
  if (recommendedId === null) return null;
  const sorted = [...topics].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((topic) => topic.id === recommendedId);
  if (index === -1 || !isGuidedComplete(sorted[index]!)) return recommendedId;
  for (let step = 1; step < sorted.length; step++) {
    const candidate = sorted[(index + step) % sorted.length]!;
    if (candidate.status !== "done" && !isGuidedComplete(candidate)) return candidate.id;
  }
  return recommendedId;
}

export type SkillTreeNode =
  | {
      kind: "topic";
      id: string;
      order: number;
      title: string;
      status: Tema["status"];
      stars: Tema["stars"];
      recommended: boolean;
      guidedProgress: TopicGuidedProgress | null;
      /** DF-P02: always false. Never gated by a "previous topic done" check. */
      locked: false;
    }
  | {
      kind: "milestone";
      id: string;
      order: number;
      title: string;
      milestoneKind: Hito["kind"];
      coversUpToOrder: number;
      status: Hito["status"];
      /** No hito ever gates progress either (DF-P05: "no impide continuar de ninguna manera"). */
      locked: false;
    };

export type SkillTreeOrder = "syllabus" | "gameMap";

/**
 * Which topic should glow as "recommended" (mockup: the larger node with a
 * pulse). Prefers an explicit `recommended` flag (set by
 * `PATCH /v1/temario/topics/:id {recommended:true}`, e.g. by a future
 * assessor-driven flow) — if no topic has it set yet (true for every
 * temario today; nothing server-side calls that endpoint automatically),
 * falls back to the first not-done topic in temario order, so the tree
 * always has something to highlight instead of glowing nothing. Returns
 * null only when there are no topics, or every topic is already `done`.
 */
export function resolveRecommendedTopicId(topics: readonly Tema[]): string | null {
  const explicit = topics.find((t) => t.recommended);
  if (explicit) return explicit.id;
  const sorted = [...topics].sort((a, b) => a.order - b.order);
  const nextUp = sorted.find((t) => t.status !== "done");
  return nextUp?.id ?? null;
}

/**
 * Display-position sort key (W3 fix for the "hitos se amontonan arriba"
 * bug): a topic sorts at its own `order`; a milestone sorts at
 * `coversUpToOrder + 0.5` — strictly after the topic whose `order` equals
 * `coversUpToOrder` and strictly before the next topic (whole numbers), so
 * it lands exactly between them regardless of the milestone's own `order`
 * value. This matters because the server's `createMilestoneTool` always
 * *appends* the milestone (its `order` keeps incrementing past every
 * topic's `order` — see the P2 DEVLOG entry this fixes), so sorting by raw
 * `order` grouped every milestone at the end/top of the tree instead of
 * where `coversUpToOrder` says it belongs.
 */
function displaySortKey(node: SkillTreeNode): number {
  return node.kind === "topic" ? node.order : node.coversUpToOrder + 0.5;
}

/**
 * Topics + milestones merged into one list, in DISPLAY order: ascending by
 * `displaySortKey`, so a milestone is interleaved right after the topic it
 * covers instead of grouped by its own (append-only) `order`. Ties (e.g.
 * two milestones covering the same topic) break on each node's own raw
 * `order`, for a stable result. `orderForBottomUpDisplay` reverses this for
 * the bottom-up screen layout — it does not need to re-sort.
 *
 * `recommendedIdOverride` (C2-d): when the caller already knows the
 * GLOBALLY recommended topic id (`resolveRecommendedTopicId` run once over
 * the WHOLE temario, not this slice), pass it here instead of letting this
 * function re-derive one from `temario.topics` alone. Needed because the
 * grouped/collapsible-by-unit rendering (`temario.tsx`, `lib/temarioGroups.ts`)
 * calls this once per unit with only that unit's topics — without the
 * override, `resolveRecommendedTopicId`'s "first not-done" fallback would
 * pick a false "recommended" node in EVERY unit that doesn't contain the
 * real one, instead of just the one unit that does (breaking the "only one
 * push" rule the whole tree is built on). `undefined` (the default) keeps
 * every existing (ungrouped) call site's behavior identical; `null` is a
 * valid override meaning "no recommended topic in this slice at all".
 */
export function buildSkillTreeNodes(
  temario: Pick<Temario, "topics" | "milestones">,
  recommendedIdOverride?: string | null,
): SkillTreeNode[] {
  const recommendedId = recommendedIdOverride !== undefined ? recommendedIdOverride : resolveRecommendedTopicId(temario.topics);

  const topicNodes: SkillTreeNode[] = temario.topics.map((topic) => ({
    kind: "topic",
    id: topic.id,
    order: topic.order,
    title: topic.title,
    status: topic.status,
    stars: topic.stars,
    recommended: topic.id === recommendedId,
    guidedProgress: deriveTopicGuidedProgress(topic.guidedProgress),
    locked: false,
  }));

  const milestoneNodes: SkillTreeNode[] = temario.milestones.map((milestone) => ({
    kind: "milestone",
    id: milestone.id,
    order: milestone.order,
    title: milestone.title,
    milestoneKind: milestone.kind,
    coversUpToOrder: milestone.coversUpToOrder,
    status: milestone.status,
    locked: false,
  }));

  return [...topicNodes, ...milestoneNodes].sort((a, b) => {
    const keyDiff = displaySortKey(a) - displaySortKey(b);
    return keyDiff !== 0 ? keyDiff : a.order - b.order;
  });
}

/** Done-count/total/percent for the screen's progress bar ("Tema X / N · P%") — 0% when there are no topics (avoids NaN), never derived from milestones. */
export interface TemarioProgress {
  doneCount: number;
  total: number;
  /** 0-100, rounded. */
  percent: number;
}

export function deriveTemarioProgress(topics: readonly Tema[]): TemarioProgress {
  const total = topics.length;
  const doneCount = topics.filter((topic) => topic.status === "done").length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  return { doneCount, total, percent };
}

/**
 * Mockup layout (assets/estudios.html): the tree grows bottom→top — done/
 * earlier topics sit at the bottom of the screen, upcoming ones at the top.
 * `buildSkillTreeNodes` returns ascending temario order (index 0 = first
 * topic); reversing it gives the array a caller can map straight into a
 * top-to-bottom list (index 0 renders at the top of the screen = highest
 * order = "por venir", last index = lowest order = bottom = "inicio").
 */
export function orderForBottomUpDisplay(nodes: readonly SkillTreeNode[]): SkillTreeNode[] {
  return [...nodes].reverse();
}

/**
 * Explicit display order. Grouped syllabus chapters read top-to-bottom in
 * curricular order; the legacy flat game map keeps its bottom-up layout.
 */
export function orderSkillTreeNodes(
  nodes: readonly SkillTreeNode[],
  order: SkillTreeOrder,
): SkillTreeNode[] {
  return order === "syllabus" ? [...nodes] : orderForBottomUpDisplay(nodes);
}

/** Which chrome copy sits above/below the rail for a given display order. */
export type SkillTreeCapKind = "start" | "advancedUp" | "advancedDown";

export type SkillTreeCapSlot = {
  kind: SkillTreeCapKind;
  arrow: "up" | "down" | null;
};

export type SkillTreeChrome = {
  top: SkillTreeCapSlot;
  bottom: SkillTreeCapSlot;
};

/**
 * `gameMap` keeps the mockup's bottom-up chrome (advanced ↑ at the top,
 * start cap at the bottom). `syllabus` is curricular top-down: start cap
 * on top, advanced hint below, never a false up-arrow.
 */
export function skillTreeChrome(order: SkillTreeOrder): SkillTreeChrome {
  if (order === "syllabus") {
    return {
      top: { kind: "start", arrow: null },
      bottom: { kind: "advancedDown", arrow: "down" },
    };
  }
  return {
    top: { kind: "advancedUp", arrow: "up" },
    bottom: { kind: "start", arrow: null },
  };
}

export function formatSkillTreeCap(
  slot: SkillTreeCapSlot,
  copy: { start: string; advancedUp: string; advancedDown: string },
): string {
  const text = slot.kind === "start" ? copy.start : slot.kind === "advancedUp" ? copy.advancedUp : copy.advancedDown;
  if (slot.arrow === "up") return `↑ ${text}`;
  if (slot.arrow === "down") return `↓ ${text}`;
  return text;
}
