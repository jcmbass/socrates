/**
 * assessor-v4 — rúbrica MECÁNICA: el modelo OBSERVA, el código JUZGA.
 *
 * Por qué existe (migración DeepInfra, 2026-08-11): gemma-4-31B-it y
 * DeepSeek-V4-Flash fallaron la calibración del gate O-14 inflando la
 * severidad (60.7% y 42.9% de laxitud contra un umbral de 20%; el release
 * `-0731` bajó a 25.0%, todavía por encima). El patrón medido es que ambos
 * modelos son buenos OBSERVANDO hechos del transcript y malos SIENDO
 * SEVEROS. La v4 les saca la severidad: el modelo devuelve observaciones
 * verificables y esta función determinista —testeable, sin desvío, que no
 * depende de a qué le tenga miedo un modelo— calcula el veredicto.
 *
 * Es el final lógico de la lección de PB6 (`buxo-assessor-v3` pasó con Sonnet
 * gracias a tres reglas mecánicas): la rúbrica mecánica le gana al juicio del
 * modelo, y es lo que les da chance a los modelos baratos.
 *
 * DÓNDE VIVE Y POR QUÉ: en `packages/core`, junto a la rúbrica de la que saca
 * su autoridad, para que la consuman LOS DOS — el `assess.ts` del servidor y
 * el adapter del gate. Si viviera sólo en `apps/gate-runner`, el gate mediría
 * un producto que no le servimos a nadie.
 *
 * DISCIPLINA ANTI-SOBREAJUSTE: cada rama sale de la DEFINICIÓN escrita de la
 * rúbrica (`getAssessorSystemPrompt`: el mapeo banda←entendimiento de la línea
 * de `recommendedBand`, las reglas 1-3 del bloque `tutorLedRubric`, y "A
 * student saying 'I get it now' demonstrates nothing by itself"), NO de los 28
 * ítems del golden set. Si alguien se encuentra ajustando una rama porque "así
 * pasa el ítem ollama-011", eso es sobreajuste: parar. Los tests de
 * `__tests__/mechanical-rubric.test.ts` usan evidencia FABRICADA por la misma
 * razón: verifican la regla, no el dataset.
 */
import { z } from "zod";
import { type Band } from "@buxo/core/prompts";
import type { DemonstratedUnderstanding } from "./session";

/** Versión de prompt de la rúbrica por evidencia (ver `getAssessorV4SystemPrompt`). */
export const ASSESSOR_V4_PROMPT_VERSION = "buxo-assessor-v4";

/**
 * A3b — variante locale de la v4: el prompt es `getAssessorV4SystemPrompt`
 * con `options.locale` (apéndice `buildAssessorLocaleSection`). Un render con
 * locale es una variante NUNCA corrida contra modelo real: la persistencia
 * DEBE guardar ESTA versión cuando se pasó la opción y
 * `ASSESSOR_V4_PROMPT_VERSION` cuando no (patrón G4 de
 * `PROMPT_VERSION_LOCALE` en prompts.ts).
 */
export const ASSESSOR_V4_PROMPT_VERSION_LOCALE = "buxo-assessor-v4-locale";

// ---------------------------------------------------------------------------
// Lo que el modelo OBSERVA — hechos verificables, cero juicios de severidad
// ---------------------------------------------------------------------------

export const mechanicalEvidenceSchema = z.object({
  /** El mensaje más reciente del estudiante contiene una razón o justificación explícita. */
  studentGaveReasoning: z.boolean(),
  /** Esa razón está en palabras PROPIAS (no repite el fraseo del tutor). Solo importa si studentGaveReasoning. */
  reasoningInOwnWords: z.boolean(),
  /** El mensaje es un resultado pelado, sin justificación. */
  bareResultOnly: z.boolean(),
  /** El mensaje solo asiente ("sí", "ya veo", "ok") sin sustancia detrás. */
  agreementOnly: z.boolean(),
  /** El mensaje es solo una pregunta, sin contenido propio del estudiante. */
  questionOnly: z.boolean(),
  /** En un turno ANTERIOR (no este) el tutor dio el método, los valores de prueba o la estructura de la solución. */
  tutorSuppliedMethodEarlier: z.boolean(),
  /** El mensaje más reciente ejecuta ese método/valores/estructura. Solo importa si tutorSuppliedMethodEarlier. */
  studentExecutesTutorMethod: z.boolean(),
  /** El mensaje solo sustituye valores porque el tutor pidió verificar (regla 3 de v3). */
  mechanicalVerificationOnly: z.boolean(),
  /** El estudiante se autocorrigió en este turno o en uno reciente. */
  selfCorrected: z.boolean(),
  /** Coherencia interna del razonamiento. NO es exactitud factual: el assessor no la juzga. null = no hay razonamiento que juzgar. */
  reasoningCoherent: z.boolean().nullable(),
  /** 1-3 frases para el log del founder, en el idioma de la conversación. Nunca se le muestra al estudiante. */
  rationale: z.string(),
});

export type MechanicalEvidence = z.infer<typeof mechanicalEvidenceSchema>;

// ---------------------------------------------------------------------------
// Derivación determinista
// ---------------------------------------------------------------------------

const DU_RANK: Record<DemonstratedUnderstanding, number> = { none: 0, weak: 1, developing: 2, solid: 3 };
const BAND_RANK: Record<Band, number> = { guiding: 0, probing: 1, minimal: 2 };

function capDu(du: DemonstratedUnderstanding, cap: DemonstratedUnderstanding): DemonstratedUnderstanding {
  return DU_RANK[du] <= DU_RANK[cap] ? du : cap;
}
function capBand(band: Band, cap: Band): Band {
  return BAND_RANK[band] <= BAND_RANK[cap] ? band : cap;
}

export interface MechanicalGrade {
  demonstratedUnderstanding: DemonstratedUnderstanding;
  recommendedBand: Band;
  /** Derivados de la MISMA evidencia — los consume el motor de dominio (rachas, mastery). */
  explainedInOwnWords: boolean;
  guessedOrPatternMatched: boolean;
  rationale: string;
}

/**
 * Mapea la evidencia observada al veredicto completo del assessor.
 *
 * Cada rama cita la parte de la rúbrica de la que sale:
 *
 * - `none` — SOLO para el asentimiento vacío y el mensaje sin ningún
 *   contenido propio ("A student saying 'I get it now' demonstrates nothing
 *   by itself"). CORREGIDO 2026-08-11 (2ª corrida): la frontera anterior
 *   (pregunta→none, mimetizar→none) era un escalón demasiado dura — el
 *   ground-truth de wq5-2-001 es `weak` ("muestra conciencia de dos métodos
 *   posibles... Comprensión superficial").
 * - `weak` — hubo contenido pero no alcanza: pregunta con conciencia de
 *   métodos, mimetizar al tutor (mimicry, hay contenido mal atribuido), un
 *   resultado sin justificar ("an answer with no justification"), o
 *   razonamiento propio incoherente. Intentó; no demostró.
 * - `developing` — razonamiento propio y coherente pero con coherencia no
 *   juzgable (null): no se castiga con weak ni se premia con solid sin
 *   evidencia. También es el techo de las reglas 1 y 3.
 * - `solid` — razonamiento propio y coherente. FIX 1 (arquitecto,
 *   2026-08-11): NO exige autocorrección — la rúbrica la describe como
 *   evidencia TÍPICA ("explains in their own words, self-corrects"), no como
 *   conjunción obligatoria. Razonar bien a la primera y explicarlo con
 *   palabras propias demuestra entendimiento sólido; exigir haberse
 *   equivocado antes es un requisito que la rúbrica no pone.
 * - Reglas 1 (techo tutor-led) y 3 (verificación mecánica) del bloque
 *   `tutorLedRubric`, aplicadas como techos, literalmente.
 * - La banda sale del entendimiento porque la rúbrica YA la define así:
 *   "guiding = understanding is none/weak; probing = developing; minimal =
 *   ONLY when the student has demonstrated solid understanding". Pedirle al
 *   modelo las dos cosas por separado es pedirle que se contradiga — y es
 *   exactamente lo que hizo en 2 de los 7 ítems laxos de `-0731`.
 */
export function gradeFromEvidence(e: MechanicalEvidence): MechanicalGrade {
  // --- Entendimiento base: qué produjo el estudiante que sea SUYO ---
  // Frontera corregida (2ª corrida, ground-truth del founder): `none` SOLO
  // para el asentimiento pelado y el mensaje sin ningún contenido propio.
  // Pregunta con conciencia, mimetizar al tutor y resultado sin justificar
  // son `weak` — hay contenido, aunque no sea razonamiento propio todavía.
  let du: DemonstratedUnderstanding;
  if (e.agreementOnly) {
    du = "none"; // asentimiento vacío: nada propio
  } else if (!e.studentGaveReasoning && !e.bareResultOnly && !e.questionOnly) {
    du = "none"; // mensaje sin ningún contenido propio
  } else if (e.questionOnly) {
    du = "weak"; // pregunta con conciencia de métodos (GT wq5-2-001 = weak)
  } else if (e.bareResultOnly) {
    du = "weak"; // intento propio sin justificar
  } else if (e.studentGaveReasoning && !e.reasoningInOwnWords) {
    du = "weak"; // mimetiza al tutor: contenido, mal atribuido
  } else if (e.studentGaveReasoning && e.reasoningCoherent === false) {
    du = "weak"; // razonamiento propio incoherente: intentó, no demostró
  } else if (e.studentGaveReasoning && e.reasoningCoherent === null) {
    du = "developing"; // propio, coherencia no juzgable: conservador (ni weak ni solid sin evidencia)
  } else if (e.studentGaveReasoning) {
    du = "solid"; // FIX 1: razonamiento propio y coherente → solid, SIN exigir autocorrección
  } else {
    du = "none";
  }

  // --- Regla 3: verificación mecánica pedida por el tutor → techo developing ---
  if (e.mechanicalVerificationOnly) du = capDu(du, "developing");

  // --- Regla 1: el tutor dio el método y el estudiante lo ejecuta → techo developing/probing ---
  const tutorLed = e.tutorSuppliedMethodEarlier && e.studentExecutesTutorMethod;
  if (tutorLed) du = capDu(du, "developing");

  // --- Banda: función del entendimiento, según la definición de la rúbrica ---
  let band: Band = du === "solid" ? "minimal" : du === "developing" ? "probing" : "guiding";
  if (tutorLed) band = capBand(band, "probing");

  // --- Los dos booleanos que consume el motor de dominio, de la MISMA evidencia ---
  const explainedInOwnWords = e.studentGaveReasoning && e.reasoningInOwnWords;
  const guessedOrPatternMatched =
    e.agreementOnly || e.questionOnly || e.bareResultOnly || (e.studentGaveReasoning && !e.reasoningInOwnWords);

  return {
    demonstratedUnderstanding: du,
    recommendedBand: band,
    explainedInOwnWords,
    guessedOrPatternMatched,
    rationale: e.rationale,
  };
}
