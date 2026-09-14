/**
 * Ordering arithmetic behind the "flechas de orden" topic editor (default
 * chosen over drag-and-drop — see DEVLOG). Shared by `TemarioTopicEditor`
 * and `app/subjects/[subjectId]/temario.tsx`.
 *
 * C2-c: the per-subject `SubjectConfigState` machine that used to live here
 * (statuses `empty`/`reading_pdf`/`building_temario`/etc., plus
 * `initialSubjectConfigStates`/`patchSubjectConfig`/`subjectConfig`) was
 * removed with `app/onboard/paso-3-temario.tsx` — paso-3 no longer
 * configures a temario per subject (seed subjects arrive with one already
 * built; onboarding never blocks on PDF ingest). That capability is not
 * gone: `app/subjects/[subjectId]/temario.tsx`'s own empty-state ("Subir
 * PDF" / "Manual", `skillTree.emptyState`) already covers ANY subject with
 * an empty temario — including a custom one created during onboarding —
 * and was never onboarding-specific to begin with.
 */
import type { Tema, Temario } from "./api/types";

/** Topics sorted by `order` — defensive re-sort so rendering never depends on the server response's array order. */
export function sortedTopics(temario: Temario): Tema[] {
  return [...temario.topics].sort((a, b) => a.order - b.order);
}

/** Ids of the sorted topics, in order — the `orderedIds` payload `reorderTopics` expects. */
export function orderedTopicIds(temario: Temario): string[] {
  return sortedTopics(temario).map((topic) => topic.id);
}

/**
 * Swaps `id` with its neighbor in the given direction. Returns the SAME
 * array reference-shape (a new array, same ids, unchanged) when `id` is
 * already at the edge in that direction — the caller can skip the
 * `reorderTopics` call when the result is `===` no-op-equal by value
 * (compare with the input, not by reference).
 */
export function moveOrderedId(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const index = ids.indexOf(id);
  if (index === -1) return [...ids];
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= ids.length) return [...ids];
  const next = [...ids];
  const a = next[index]!;
  const b = next[swapWith]!;
  next[index] = b;
  next[swapWith] = a;
  return next;
}
