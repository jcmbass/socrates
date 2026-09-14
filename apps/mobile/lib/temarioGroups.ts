/**
 * Temario groups-by-unit (C2-d) — pure logic that groups a flat topic list
 * into syllabus units for the collapsible-sections UI in
 * `app/subjects/[subjectId]/temario.tsx`. Lives next to `skillTree.ts` for
 * the same reason: pure TS the component layer hands real `Temario` data
 * to, testable outside react-native (`vitest.config.ts`'s test surface).
 *
 * Exists because a seed-activated materia (`Subject.seedCatalogKey`
 * non-null, C1-b) can carry up to 236 topics (`universidad/fisica`, en) —
 * unusable as the flat rail `SkillTree`/`lib/skillTree.ts` already renders.
 * `Tema.unitLabel` (migración 0015, C1-b) is the syllabus unit the server
 * already populated per topic for exactly this grouping; it's `null` for
 * EVERY topic of a student's own (non-seed) subject.
 */
import type { Hito, Tema, Temario } from "./api/types";

export interface TemarioUnitGroup {
  /**
   * `null` only for a "sin unidad" bucket inside an otherwise-grouped
   * temario — some topics never got a unit assigned (mixed data). A
   * materia with EVERY topic's `unitLabel` null never reaches this shape at
   * all (see `groupTopicsByUnit`'s `null` return below).
   */
  unitLabel: string | null;
  topics: Tema[];
  milestones: Hito[];
  doneCount: number;
  total: number;
}

/**
 * Groups topics (temario `order`) into units, in first-appearance order —
 * a milestone joins the group of the LAST topic it covers
 * (`coversUpToOrder`); one that covers before every topic (shouldn't
 * happen — `assertHitoCoversWithinTemario` guards this server-side) falls
 * back to the first group instead of being silently dropped.
 *
 * Returns `null` when there are no topics, or EVERY topic's `unitLabel` is
 * `null` (a student's own subject, C1-b) — the caller MUST fall back to
 * rendering the existing flat `SkillTree` unchanged in that case (D-C2-d:
 * "se ven EXACTAMENTE como hoy"), never an empty/degenerate grouped UI.
 */
export function groupTopicsByUnit(temario: Pick<Temario, "topics" | "milestones">): TemarioUnitGroup[] | null {
  const topics = [...temario.topics].sort((a, b) => a.order - b.order);
  if (topics.length === 0) return null;
  if (topics.every((topic) => topic.unitLabel === null)) return null;

  const groups: TemarioUnitGroup[] = [];
  const indexByLabel = new Map<string | null, number>();
  for (const topic of topics) {
    let index = indexByLabel.get(topic.unitLabel);
    if (index === undefined) {
      index = groups.length;
      indexByLabel.set(topic.unitLabel, index);
      groups.push({ unitLabel: topic.unitLabel, topics: [], milestones: [], doneCount: 0, total: 0 });
    }
    const group = groups[index]!;
    group.topics.push(topic);
    group.total += 1;
    if (topic.status === "done") group.doneCount += 1;
  }

  for (const milestone of temario.milestones) {
    const owner = [...topics].reverse().find((topic) => topic.order <= milestone.coversUpToOrder);
    const label = owner ? owner.unitLabel : topics[0]!.unitLabel;
    groups[indexByLabel.get(label)!]!.milestones.push(milestone);
  }

  return groups;
}

/**
 * The group containing `topicId` (used to decide which section starts
 * expanded — the one holding the temario's globally-recommended topic,
 * `resolveRecommendedTopicId` — see this module's docblock and the screen's
 * usage). `null` when the topic isn't in any group (shouldn't happen for a
 * real recommended-topic id computed off the SAME temario).
 */
export function findUnitGroupForTopic(groups: readonly TemarioUnitGroup[], topicId: string): TemarioUnitGroup | null {
  return groups.find((group) => group.topics.some((topic) => topic.id === topicId)) ?? null;
}

/**
 * Level caption for the temario header (C2-d, requirement #2): derives
 * "bachillerato" | "universidad" from `Subject.seedCatalogKey`
 * (`"<nivel>/<materia>"`, e.g. "universidad/quimica" — the format
 * `routes/courses.ts`'s seed-subjects activation writes). `null` for a
 * student's own subject (`seedCatalogKey` is `null`) or an unrecognized
 * prefix (defensive — never throws on unexpected server data).
 */
export function seedLevelFromCatalogKey(catalogKey: string | null): "bachillerato" | "universidad" | null {
  if (catalogKey === null) return null;
  const level = catalogKey.split("/")[0];
  return level === "bachillerato" || level === "universidad" ? level : null;
}
