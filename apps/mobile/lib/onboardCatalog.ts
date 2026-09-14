/**
 * Pure subject-selection logic for P3/C2-c paso-2-materias. Replaces the
 * original `SubjectTemplate`-driven version (P3): options now come from the
 * **seed catalog** (`getSeedSubjects(level)`, C2-a) instead of
 * `subjectTemplatesForGradeLevel` — that fixed a real bug, universidad had
 * NO templates (R-2) so paso-2 rendered empty for every university student;
 * the seed catalog has 5 subjects for both bachillerato and universidad.
 *
 * `courses/new.tsx` still uses `subjectTemplatesForGradeLevel` directly for
 * its own (non-onboarding) flow — untouched, this module no longer depends
 * on it.
 *
 * A `SubjectSelection` is one of three sources:
 * - `"existing"` — a Subject the student already has on this course (D-C07:
 *   a tester with `onboardingCompletedAt: null` who re-enters this wizard
 *   keeps their own subjects; onboarding only ever ADDS, see
 *   `onboardFlow.activateOnboardSeedSubjects`/`createOnboardSubjects` — no
 *   delete path exists here, so toggling an "existing" row off is
 *   cosmetic, not destructive).
 * - `"seed"` — a catalog subject not yet activated on this course
 *   (`activeSeedKeys` filters out ones the student already has, so an
 *   already-active seed subject shows once, as "existing", never twice).
 * - `"custom"` — free-text, added via "Crear mi propia materia" (DF-P09,
 *   demoted to a secondary action at the end of the list, C2-c).
 *
 * All three start pre-selected (A1 §1.4: never show an empty list to
 * uncheck INTO) except a custom row, which is selected the moment it's
 * added — no point letting the student add something and leave it
 * unchecked.
 */
import type { Locale } from "../i18n";
import { gradeLevelById } from "./catalog";
import type { SeedSubjectOption } from "./api/types";

export type SeedLevel = "bachillerato" | "universidad";

const STAGE_TO_SEED_LEVEL: Record<string, SeedLevel> = {
  "sv-bachillerato": "bachillerato",
  "sv-universidad": "universidad",
};

/**
 * Derives the seed-catalog `level` from a grade level id
 * (`sv-bachillerato-*` ⇒ "bachillerato", `sv-universidad-*` ⇒
 * "universidad") via its `GradeLevel.stageId` — reuses `lib/catalog.ts`
 * rather than re-parsing the id string. `null` for básica (disabled,
 * DF-P01) or an unknown id.
 */
export function seedLevelForGradeLevelId(gradeLevelId: string): SeedLevel | null {
  const gradeLevel = gradeLevelById(gradeLevelId);
  if (!gradeLevel) return null;
  return STAGE_TO_SEED_LEVEL[gradeLevel.stageId] ?? null;
}

export type SubjectSource = "existing" | "seed" | "custom";

export interface SubjectSelection {
  id: string;
  name: string;
  source: SubjectSource;
  selected: boolean;
  /** Only set for `source: "seed"` — the key `activateSeedSubjects` expects. */
  seedKey?: string;
}

export interface ExistingSubjectInput {
  id: string;
  name: string;
  seedCatalogKey: string | null;
}

let customIdCounter = 0;

/** Deterministic-enough for a client-only draft id (never sent to the server) — avoids pulling in `crypto.randomUUID` for a value that only needs to be unique within one wizard session. */
function nextCustomId(): string {
  customIdCounter += 1;
  return `custom-${Date.now()}-${customIdCounter}`;
}

/**
 * Subject keys (`matematicas`, `fisica`, …) already active on this course.
 * `Subject.seedCatalogKey` is stored as `"<level>/<subjectKey>"` (C2-a);
 * `seedSubjectSelections` matches on `SeedSubjectOption.subjectKey` alone —
 * so we strip the level prefix here. Passing the raw catalog key made the
 * includes() check always miss (C4 capture: paso-2 listed every seed twice
 * and the badge read "10 materias seleccionadas").
 */
export function activeSeedKeys(subjects: readonly ExistingSubjectInput[]): string[] {
  return subjects
    .map((subject) => subject.seedCatalogKey)
    .filter((key): key is string => key !== null)
    .map((key) => {
      const slash = key.lastIndexOf("/");
      return slash >= 0 ? key.slice(slash + 1) : key;
    });
}

export function existingSubjectSelections(subjects: readonly ExistingSubjectInput[]): SubjectSelection[] {
  return subjects.map((subject) => ({ id: subject.id, name: subject.name, source: "existing", selected: true }));
}

/** `alreadyActiveKeys` — see `activeSeedKeys` — excludes seed subjects the student already has. */
export function seedSubjectSelections(
  seedSubjects: readonly SeedSubjectOption[],
  locale: Locale,
  alreadyActiveKeys: readonly string[] = [],
): SubjectSelection[] {
  const active = new Set(alreadyActiveKeys);
  return seedSubjects
    .filter((option) => !active.has(option.subjectKey))
    .map((option) => ({
      id: `seed-${option.subjectKey}`,
      name: option.name[locale],
      source: "seed",
      selected: true,
      seedKey: option.subjectKey,
    }));
}

/** Combines the student's existing subjects with the not-yet-active seed suggestions — the full initial list paso-2 renders. */
export function initialSubjectSelections(
  existing: readonly ExistingSubjectInput[],
  seedSubjects: readonly SeedSubjectOption[],
  locale: Locale,
): SubjectSelection[] {
  return [...existingSubjectSelections(existing), ...seedSubjectSelections(seedSubjects, locale, activeSeedKeys(existing))];
}

export function toggleSelection(selections: readonly SubjectSelection[], id: string): SubjectSelection[] {
  return selections.map((selection) => (selection.id === id ? { ...selection, selected: !selection.selected } : selection));
}

/** Adds a trimmed custom subject, pre-selected. Returns the SAME array (no-op) for a blank name — callers should validate before calling, this is just a safety net for the pure function's contract. */
export function addCustomSubject(selections: readonly SubjectSelection[], name: string): SubjectSelection[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [...selections];
  return [...selections, { id: nextCustomId(), name: trimmed, source: "custom", selected: true }];
}

export function removeSelection(selections: readonly SubjectSelection[], id: string): SubjectSelection[] {
  return selections.filter((selection) => selection.id !== id);
}

export function selectedCount(selections: readonly SubjectSelection[]): number {
  return selections.filter((selection) => selection.selected).length;
}

/** Seed keys to POST to `activateSeedSubjects`, in display order. */
export function selectedSeedKeys(selections: readonly SubjectSelection[]): string[] {
  return selections
    .filter((selection): selection is SubjectSelection & { seedKey: string } => selection.source === "seed" && selection.selected && selection.seedKey !== undefined)
    .map((selection) => selection.seedKey);
}

/** Custom names to POST as Subjects (`createOnboardSubjects`), in display order. */
export function selectedCustomNames(selections: readonly SubjectSelection[]): string[] {
  return selections.filter((selection) => selection.source === "custom" && selection.selected).map((selection) => selection.name);
}
