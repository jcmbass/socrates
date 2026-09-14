/**
 * A2 — locale-aware labels for the El Salvador seed catalog
 * (`@buxo/domain/data/el-salvador`), resolved by the data's STABLE
 * ids/keys — NEVER by its Spanish text — into the i18n catalog's
 * `t.catalog.*` section.
 *
 * Fallback contract: any id/nameKey the i18n catalog doesn't know falls
 * back to the data's `defaultLabel`/`defaultName` (or the raw id for a
 * grade level the catalog can't find). Future server-provided stages,
 * grade levels or subjects (e.g. a second country's system) keep
 * rendering instead of crashing — they simply show in the seed locale.
 *
 * All functions are pure (catalog + locale in, label out) so they're
 * unit-testable in node — same discipline as `lib/catalog.ts`.
 */
import type {
  EducationStage,
  GradeLevel,
  SubjectTemplate,
} from "@buxo/domain/education-catalog";

import { gradeLevelById } from "./catalog";
import type { Strings } from "../i18n/es";

type Catalog = Strings["catalog"];

/** `subjectTemplate.<key>` → `t.catalog.subjects` key. */
const SUBJECT_KEY_BY_NAMEKEY: Partial<Record<SubjectTemplate["nameKey"], keyof Catalog["subjects"]>> = {
  "subjectTemplate.matematica": "matematica",
  "subjectTemplate.fisica": "fisica",
  "subjectTemplate.quimica": "quimica",
  "subjectTemplate.lenguajeYLiteratura": "lenguajeYLiteratura",
  "subjectTemplate.historiaDeElSalvador": "historiaDeElSalvador",
  "subjectTemplate.ingles": "ingles",
};

/** `sv-<key>` stage ids → `t.catalog.stages` key. */
const STAGE_KEYS: readonly (keyof Catalog["stages"])[] = ["basica", "bachillerato", "universidad"];

function stageKeyOf(stageId: string): keyof Catalog["stages"] | null {
  const suffix = stageId.replace(/^sv-/, "");
  return (STAGE_KEYS as readonly string[]).includes(suffix) ? (suffix as keyof Catalog["stages"]) : null;
}

/** Stage chip label (onboarding paso-1, courses/new). */
export function stageLabel(stage: EducationStage, t: Strings): string {
  const key = stageKeyOf(stage.id);
  return key ? t.catalog.stages[key] : stage.defaultLabel;
}

/** GradeLevel radio-row label (onboarding paso-1, courses/new). */
export function gradeLevelLabel(level: GradeLevel, t: Strings): string {
  const match = /^sv-(basica|bachillerato|universidad)-(\d+)$/.exec(level.id);
  if (!match) return level.defaultLabel;
  const n = Number(match[2]);
  switch (match[1]) {
    case "basica":
      return t.catalog.gradeLevels.basica(n);
    case "bachillerato":
      return t.catalog.gradeLevels.bachillerato(n);
    case "universidad":
      return t.catalog.gradeLevels.universidad(n);
    default:
      return level.defaultLabel;
  }
}

/** Label for a bare gradeLevelId (course detail header, onboarding paso-2 caption). Unknown ids render as-is. */
export function gradeLevelIdLabel(gradeLevelId: string, t: Strings): string {
  const level = gradeLevelById(gradeLevelId);
  return level ? gradeLevelLabel(level, t) : gradeLevelId;
}

/** SubjectTemplate row label (onboarding paso-2, courses/new). */
export function subjectTemplateLabel(template: SubjectTemplate, t: Strings): string {
  const key = SUBJECT_KEY_BY_NAMEKEY[template.nameKey];
  return key ? t.catalog.subjects[key] : template.defaultName;
}