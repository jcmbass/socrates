/**
 * Ephemeral cross-screen state for the P3 onboarding wizard
 * (paso-1-grados → paso-2-materias → paso-3-temario). expo-router screens
 * are separate route components with no shared props, so the grade chosen
 * in step 1 and the subjects created in step 2 need somewhere to live while
 * the student walks through the wizard — this is that somewhere.
 *
 * Deliberately NOT persisted (unlike `lib/store.ts`'s auth session): this
 * is a few seconds of in-memory wizard state, not something that should
 * survive an app restart. A restart mid-wizard just restarts the wizard —
 * the Course/Subjects already created server-side are the durable record
 * (same recovery story `courses/index.tsx` already gives any half-finished
 * session, onboarded or not).
 *
 * Same zustand/vanilla shape as `lib/store.ts` so the pattern is familiar,
 * minus the LocalStore plumbing this doesn't need.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";

/**
 * A Subject already on this course by the time paso-2 hands off to paso-3 —
 * either pre-existing (D-C07: a tester re-entering the wizard), newly
 * seed-activated, or newly created as a custom subject.
 *
 * `topicCount` (C2-c) feeds paso-3's honest resumen ("N materias · M temas
 * listos", `lib/onboardSummary.ts`) — optional so `setSubjects` calls that
 * predate this field (existing tests) keep typechecking; a subject with no
 * count is treated as 0 topics.
 */
export interface OnboardSubjectDraft {
  id: string;
  name: string;
  topicCount?: number;
}

export interface OnboardDraftState {
  gradeLevelId: string | null;
  courseId: string | null;
  subjects: OnboardSubjectDraft[];
}

export interface OnboardDraftActions {
  /** paso-1: grade chosen, Course created server-side. */
  setGrade(input: { gradeLevelId: string; courseId: string }): void;
  /** paso-2: Subjects created server-side for the course above. */
  setSubjects(subjects: OnboardSubjectDraft[]): void;
  /** Wizard finished (or abandoned) — drop the draft so a later re-entry starts clean. */
  reset(): void;
}

export type OnboardDraftStore = OnboardDraftState & OnboardDraftActions;

export const EMPTY_ONBOARD_DRAFT: OnboardDraftState = {
  gradeLevelId: null,
  courseId: null,
  subjects: [],
};

export function createOnboardDraftStore(): StoreApi<OnboardDraftStore> {
  return createStore<OnboardDraftStore>()((set) => ({
    ...EMPTY_ONBOARD_DRAFT,
    setGrade({ gradeLevelId, courseId }) {
      set({ gradeLevelId, courseId });
    },
    setSubjects(subjects) {
      set({ subjects });
    },
    reset() {
      set({ ...EMPTY_ONBOARD_DRAFT });
    },
  }));
}

export const onboardDraft = createOnboardDraftStore();

export function useOnboardDraft<T>(selector: (state: OnboardDraftStore) => T): T {
  return useStore(onboardDraft, selector);
}
