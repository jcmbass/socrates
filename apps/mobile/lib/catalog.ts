/**
 * Read-only helpers over the @buxo/domain El Salvador education catalog
 * (A1 §1.4 / A2 §2.2). Pure functions, unit-tested in node.
 *
 * Product rules encoded here, not in screens:
 * - Only stages with at least one `enabled` GradeLevel are selectable
 *   (etapa 1: bachillerato + universidad). Básica is SHOWN but disabled
 *   ("próximamente"), never hidden — A1 §1.4 / A-spec §8.3.
 * - Subject templates exist only for bachillerato (seeded that way in
 *   @buxo/domain/data/el-salvador; universidad starts empty by design).
 */
import type {
  EducationStage,
  GradeLevel,
  SubjectTemplate,
} from "@buxo/domain/education-catalog";
import {
  EL_SALVADOR_EDUCATION_STAGES,
  EL_SALVADOR_GRADE_LEVELS,
  EL_SALVADOR_SUBJECT_TEMPLATES,
} from "@buxo/domain/data/el-salvador";

export interface StageOption {
  stage: EducationStage;
  /** True iff the stage has at least one enabled GradeLevel. */
  enabled: boolean;
}

/** All stages in progression order, each flagged selectable-or-not. */
export function stageOptions(): StageOption[] {
  return [...EL_SALVADOR_EDUCATION_STAGES]
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({
      stage,
      enabled: EL_SALVADOR_GRADE_LEVELS.some(
        (level) => level.stageId === stage.id && level.enabled,
      ),
    }));
}

/** Enabled grade levels of a stage, in order. Empty for disabled stages. */
export function enabledGradeLevelsForStage(stageId: string): GradeLevel[] {
  return EL_SALVADOR_GRADE_LEVELS.filter(
    (level) => level.stageId === stageId && level.enabled,
  ).sort((a, b) => a.order - b.order);
}

export function gradeLevelById(gradeLevelId: string): GradeLevel | undefined {
  return EL_SALVADOR_GRADE_LEVELS.find((level) => level.id === gradeLevelId);
}

/**
 * Suggested subjects for a grade level, in template order. Non-empty only
 * for bachillerato levels; screens pre-select ALL of them (A1 §1.4: the
 * student unchecks what does not apply, never sees an empty first course).
 */
export function subjectTemplatesForGradeLevel(gradeLevelId: string): SubjectTemplate[] {
  return EL_SALVADOR_SUBJECT_TEMPLATES.filter(
    (template) => template.gradeLevelId === gradeLevelId,
  ).sort((a, b) => a.order - b.order);
}
