/**
 * El Salvador education catalog seed data — B3-modelo-de-dominio.md §2.3
 * ("Datos semilla (El Salvador, DF-4/O-13)") + O-13/DF-4 (multi-country
 * SHAPE, single-country DATA in etapa 1).
 *
 * Stages: básica (9 grados, `enabled: false` — not offered in etapa 1),
 * bachillerato (3 años, `enabled: true`), universidad (10 ciclos,
 * `enabled: true`).
 *
 * `SubjectTemplate` rows exist ONLY for bachillerato — per
 * `02-validacion-arquitecto.md` ("producto R-2"): "NO se modela `Career` en
 * etapa 1. Universidad arranca con materias creadas por el estudiante;
 * plantillas solo para bachillerato." No `SubjectTemplate` rows are seeded
 * for básica or universidad.
 *
 * This module is DATA, not logic — it is validated structurally (against
 * the zod schemas in `../education-catalog.ts`) in
 * `__tests__/el-salvador.test.ts`, not here.
 */
import type { EducationSystem, EducationStage, GradeLevel, SubjectTemplate } from "../education-catalog";

export const EL_SALVADOR_EDUCATION_SYSTEM: EducationSystem = {
  id: "sv",
  countryCode: "SV",
  nameKey: "educationSystem.sv.name",
  defaultName: "El Salvador",
  active: true,
  schemaVersion: 1,
};

export const EL_SALVADOR_EDUCATION_STAGES: EducationStage[] = [
  {
    id: "sv-basica",
    systemId: "sv",
    order: 1,
    labelKey: "educationStage.sv-basica.label",
    defaultLabel: "Educación básica",
    schemaVersion: 1,
  },
  {
    id: "sv-bachillerato",
    systemId: "sv",
    order: 2,
    labelKey: "educationStage.sv-bachillerato.label",
    defaultLabel: "Bachillerato",
    schemaVersion: 1,
  },
  {
    id: "sv-universidad",
    systemId: "sv",
    order: 3,
    labelKey: "educationStage.sv-universidad.label",
    defaultLabel: "Universidad",
    schemaVersion: 1,
  },
];

const BASICA_ORDINALS = [
  "1º",
  "2º",
  "3º",
  "4º",
  "5º",
  "6º",
  "7º",
  "8º",
  "9º",
] as const;

/** 9 grados, edades 6..14 (typicalAgeMin) a 7..15 (typicalAgeMax) — NOT enabled in etapa 1. */
const basicaGradeLevels: GradeLevel[] = BASICA_ORDINALS.map((ordinal, i) => {
  const order = i + 1;
  const typicalAgeMin = 5 + order;
  return {
    id: `sv-basica-${order}`,
    systemId: "sv",
    stageId: "sv-basica",
    order,
    labelKey: `gradeLevel.sv-basica-${order}.label`,
    defaultLabel: `${ordinal} grado`,
    typicalAgeMin,
    typicalAgeMax: typicalAgeMin + 1,
    enabled: false,
    schemaVersion: 1,
  };
});

const BACHILLERATO_ORDINALS = ["1°", "2°", "3°"] as const;

/** 3 años, edades ~15..18 — enabled: true (etapa 1). */
const bachilleratoGradeLevels: GradeLevel[] = BACHILLERATO_ORDINALS.map((ordinal, i) => {
  const order = i + 1;
  const typicalAgeMin = 14 + order;
  return {
    id: `sv-bachillerato-${order}`,
    systemId: "sv",
    stageId: "sv-bachillerato",
    order,
    labelKey: `gradeLevel.sv-bachillerato-${order}.label`,
    defaultLabel: `${ordinal} año de bachillerato`,
    typicalAgeMin,
    typicalAgeMax: typicalAgeMin + 1,
    enabled: true,
    schemaVersion: 1,
  };
});

/** 10 ciclos, edad variable (null/null) — enabled: true (etapa 1). */
const universidadGradeLevels: GradeLevel[] = Array.from({ length: 10 }, (_, i) => {
  const order = i + 1;
  return {
    id: `sv-universidad-${order}`,
    systemId: "sv",
    stageId: "sv-universidad",
    order,
    labelKey: `gradeLevel.sv-universidad-${order}.label`,
    defaultLabel: `Ciclo ${order}`,
    typicalAgeMin: null,
    typicalAgeMax: null,
    enabled: true,
    schemaVersion: 1,
  };
});

export const EL_SALVADOR_GRADE_LEVELS: GradeLevel[] = [
  ...basicaGradeLevels,
  ...bachilleratoGradeLevels,
  ...universidadGradeLevels,
];

/** Suggested subjects, seeded for each of the 3 bachillerato grade levels only (see module docblock). */
const BACHILLERATO_SUBJECT_TEMPLATES: ReadonlyArray<{ nameKey: string; defaultName: string }> = [
  { nameKey: "subjectTemplate.matematica", defaultName: "Matemática" },
  { nameKey: "subjectTemplate.fisica", defaultName: "Física" },
  { nameKey: "subjectTemplate.quimica", defaultName: "Química" },
  { nameKey: "subjectTemplate.lenguajeYLiteratura", defaultName: "Lenguaje y Literatura" },
  { nameKey: "subjectTemplate.historiaDeElSalvador", defaultName: "Historia de El Salvador" },
  { nameKey: "subjectTemplate.ingles", defaultName: "Inglés" },
];

export const EL_SALVADOR_SUBJECT_TEMPLATES: SubjectTemplate[] = bachilleratoGradeLevels.flatMap((gradeLevel) =>
  BACHILLERATO_SUBJECT_TEMPLATES.map((subject, i) => ({
    id: `${gradeLevel.id}-${subject.nameKey.split(".")[1]}`,
    gradeLevelId: gradeLevel.id,
    order: i + 1,
    nameKey: subject.nameKey,
    defaultName: subject.defaultName,
    schemaVersion: 1,
  })),
);
