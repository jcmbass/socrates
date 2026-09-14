/**
 * Pure helpers for the guided session recipe (D-S02, D2-b).
 * Unit-tested in lib/__tests__/guidedRecipe.test.ts — no RN imports.
 */
import type { GuidedItemPublic } from "./api/types";

export type RecipePhase = "check" | "challenge";

export type RecipeFlatStep =
  | { kind: "expose"; texts: string[] }
  | { kind: "item"; item: GuidedItemPublic; phase: RecipePhase }
  | { kind: "explain" }
  | { kind: "closure" };

const EXPOSE_TYPE = "expose" as const;

/** Stable string hash — same input always yields same integer. */
export function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Base variant from user + topic. Caller applies `avoidRepeatVariant` so the
 * same variant never runs twice in a row for one topic.
 */
export function baseRecipeVariant(userId: string, topicId: string): number {
  return hashString(`${userId}:${topicId}`) % 3;
}

/** Never repeat the previous variant (D-S02 anti-boredom). */
export function avoidRepeatVariant(base: number, lastVariant: number | null): number {
  if (lastVariant === null || lastVariant !== base) return base;
  return (base + 1) % 3;
}

export function resolveRecipeVariant(userId: string, topicId: string, lastVariant: number | null): number {
  return avoidRepeatVariant(baseRecipeVariant(userId, topicId), lastVariant);
}

/** Pick the N lowest- or highest-difficulty non-expose items (stable tie-break by id). */
export function pickByDifficulty(items: GuidedItemPublic[], count: number, order: "asc" | "desc"): GuidedItemPublic[] {
  const pool = items.filter((it) => it.type !== EXPOSE_TYPE);
  const sorted = [...pool].sort((a, b) => {
    if (a.difficulty !== b.difficulty) return order === "asc" ? a.difficulty - b.difficulty : b.difficulty - a.difficulty;
    return a.id.localeCompare(b.id);
  });
  return sorted.slice(0, count);
}

export interface BuildRecipeInput {
  items: GuidedItemPublic[];
  /** 0 = check before challenge; 1 = challenge before check; 2 = check then challenge with swapped item counts emphasis */
  variant: number;
  /** Fallback exposure copy when items are empty or degraded. */
  fallbackExposure: readonly string[];
}

/**
 * Builds the linear step list for one guided session.
 * Expose items (2–3) → checks (2) → explain → challenges (1–2) → closure,
 * with variant 1 swapping check/challenge blocks (D-S02).
 */
export function buildRecipeSteps(input: BuildRecipeInput): RecipeFlatStep[] {
  const exposeFromItems = input.items.filter((it) => it.type === EXPOSE_TYPE).slice(0, 3);
  const exposeTexts =
    exposeFromItems.length > 0 ? exposeFromItems.map((it) => it.prompt) : input.fallbackExposure.slice(0, 2);

  const checks = pickByDifficulty(input.items, 2, "asc");
  const challenges = pickByDifficulty(input.items, 2, "desc");

  const checkSteps: RecipeFlatStep[] = checks.map((item) => ({ kind: "item", item, phase: "check" }));
  const challengeSteps: RecipeFlatStep[] = challenges.map((item) => ({ kind: "item", item, phase: "challenge" }));

  const middle =
    input.variant === 1
      ? [...challengeSteps, { kind: "explain" as const }, ...checkSteps]
      : [...checkSteps, { kind: "explain" as const }, ...challengeSteps];

  return [{ kind: "expose", texts: exposeTexts }, ...middle, { kind: "closure" }];
}

/** Whether the server returned nothing usable — run degraded path. */
export function isDegradedSession(items: GuidedItemPublic[], degradedFlag: boolean): boolean {
  return degradedFlag || items.filter((it) => it.type !== EXPOSE_TYPE).length === 0;
}

/** Honest grounding label: never "general content" when Fuentes were required. */
export function shouldShowGeneralContent(
  grounding: "sources" | "general" | null,
  degradedReason: "generation_failed" | "sources_required" | null,
): boolean {
  return grounding === "general" && degradedReason !== "sources_required";
}

/** Degraded: i18n exposure → explain → closure (no items). */
export function buildDegradedSteps(fallbackExposure: readonly string[]): RecipeFlatStep[] {
  return [
    { kind: "expose", texts: fallbackExposure.slice(0, 2) },
    { kind: "explain" },
    { kind: "closure" },
  ];
}

/** Rotate microcopy index — never return the same index twice in a row. */
export function nextMicrocopyIndex(length: number, lastIndex: number | null): number {
  if (length <= 1) return 0;
  if (lastIndex === null) return 0;
  return (lastIndex + 1) % length;
}

/** D-S06 provisional level from total XP. */
export function xpLevelProgress(totalXp: number): { level: number; progress: number } {
  const safe = Math.max(0, totalXp);
  const level = Math.floor(safe / 100) + 1;
  const progress = (safe % 100) / 100;
  return { level, progress };
}

export const GUIDED_VARIANT_STORAGE_PREFIX = "socrates.guided.lastVariant.";

export function guidedVariantStorageKey(topicId: string): string {
  return `${GUIDED_VARIANT_STORAGE_PREFIX}${topicId}`;
}
