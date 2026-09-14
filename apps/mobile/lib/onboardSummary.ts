/**
 * Pure resumen for C2-c paso-3 (formerly a per-subject temario configurator,
 * now a plain summary — the seed subjects it lists arrive with their
 * temario already built, see `onboardFlow.activateOnboardSeedSubjects`).
 */
export interface OnboardSummarySubject {
  /** Topics already on the subject's temario — seed subjects report this from `SeedSubjectOption.topicCount`, custom/manual ones start at 0. */
  topicCount?: number;
}

export interface OnboardSummary {
  subjectCount: number;
  topicCount: number;
}

export function buildOnboardSummary(subjects: readonly OnboardSummarySubject[]): OnboardSummary {
  return {
    subjectCount: subjects.length,
    topicCount: subjects.reduce((sum, subject) => sum + (subject.topicCount ?? 0), 0),
  };
}
