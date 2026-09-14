/**
 * Prompt del temario-builder — P2.
 *
 * Construye el prompt que lee el texto extraído de un programa/sílabo y
 * produce topics + hitos **vía tools**. El modelo **no** inventa temas fuera
 * del programa. Los títulos son cortos y descriptivos. Los hitos (parcial /
 * examen_final) usan alcance acumulativo, con énfasis en los temas
 * posteriores al hito anterior.
 *
 * La versión del prompt viaja en O-9 (`promptVersion`) y se escribe en
 * `Temario.generatedByPromptVersion` cuando el server lo soporte.
 *
 * v2 (P2 FIX3, 2026-07-21 post-real-run REVIEW): `subjectId` YA NO viaja en
 * este prompt. La corrida real con Haiku mostró que pedirle al modelo que
 * copie un UUID literal en cada tool call es frágil (lo alucinó cuando no
 * se le dio; y aun dándoselo, es un vector innecesario para que un modelo
 * mal instruido intente dirigirse a otra materia). La raíz correcta es que
 * el modelo JAMÁS reciba `subjectId` como argumento: las tools lo toman del
 * `ToolContext` inyectado por el server desde la sesión autenticada (ver
 * `@buxo/models/tools`'s `ToolContext.subjectId` y
 * `apps/server/.../temario-tools.ts`). El prompt se simplifica en
 * consecuencia — ya no necesita `subjectId` como input.
 *
 * v3 (2026-07-25, post-M3-smoke REVIEW): el smoke real con Haiku mostró un
 * hito ("Parcial 1: Estructura y enlaces") cuyo `coversUpToOrder` excluía el
 * tema que le daba nombre ("Enlace químico") — el modelo tuvo que ADIVINAR
 * un índice contra una secuencia de creación que no controla ni observa de
 * forma fiable (`createTopic` nunca acepta `order`, ver P2 FIX2), y contó
 * mal. El arreglo estructural (`createMilestone` ahora recibe
 * `coversUpToTopicTitle`, no un índice — el server resuelve el título al
 * `order` vigente) elimina esa clase de error aunque el prompt no cambie
 * una coma; el prompt igual se ajusta acá para que el modelo intente
 * preservar el orden del programa al crear los temas (regla 3) y separe
 * las dos fases (regla 4), porque el orden de creación sigue siendo lo que
 * termina en la columna `order` de cada tema.
 *
 * v3-en (slice localización, 2026-09-06): variante opt-in `locale: "en"` del
 * mismo builder, redactada en inglés de producto (no calco del español).
 * El render default (locale omitido o "es") queda **byte-idéntico** a hoy —
 * los temarios existentes y los tests actuales no cambian. La variante en
 * NO re-genera temarios existentes: la versión del prompt se persiste en el
 * temario al CREARLO (`generatedByPromptVersion`), y cada temario conserva
 * la versión con la que nació. Patrón sancionado en fb90dc4
 * (`PROMPT_VERSION_LOCALE` en packages/core): los renders con locale son
 * variantes nunca corridas contra modelo real; la persistencia las
 * distingue del default validado.
 */

export const PROMPT_VERSION = "temario-builder-v3";

/**
 * Variante EN del temario-builder (locale "en"). Versión separada de
 * `PROMPT_VERSION` a propósito (patrón G4 de fb90dc4): una corrida con esta
 * variante nunca debe poder confundirse con una del default validado.
 * `TEMARIO_BUILDER_PROMPT_VERSION_EN` es alias explícito del mismo valor.
 */
export const PROMPT_VERSION_EN = "temario-builder-v3-en";
export const TEMARIO_BUILDER_PROMPT_VERSION_EN = PROMPT_VERSION_EN;

export type TemarioBuilderLocale = "es" | "en";

/**
 * Nombre legible del idioma para interpolar en las reglas de título/idioma,
 * para que ninguna regla quede hardcodeada a "English" y futuras locales
 * reutilicen el mismo esqueleto.
 */
export function languageName(locale: TemarioBuilderLocale): string {
  return locale === "en" ? "English" : "español";
}

export interface TemarioBuilderPromptInput {
  /** Texto extraído del programa / sílabo / guía de estudio. */
  sourceText: string;
  /** Nombre de la materia (para contexto, no para inventar contenido). */
  subjectName?: string;
  /**
   * Opt-in de idioma (slice localización). Omitido o "es": render
   * byte-idéntico al prompt histórico en español. "en": variante EN
   * (v3-en) — títulos en el idioma preferido del estudiante aunque el
   * material fuente esté en otro idioma.
   */
  locale?: TemarioBuilderLocale;
}

/**
 * Prompt system para el temario-builder.
 *
 * Reglas duras:
 * - Solo temas que aparecen explícitamente en `sourceText`.
 * - Un tema por concepto central; evita granularidad excesiva.
 * - Títulos cortos (≤60 caracteres), descriptivos, en español.
 * - Los hitos acumulan: `coversUpToOrder` = índice del último tema incluido.
 * - No agregar temas de "repaso general" ni "evaluación" como topics.
 */
export function buildTemarioBuilderSystemPrompt(
  subjectName?: string,
  locale?: TemarioBuilderLocale,
): string {
  if (locale === "en") {
    return buildTemarioBuilderSystemPromptEn(subjectName);
  }
  const subjectLine = subjectName ? ` para ${subjectName}` : "";
  return `Sos un asistente académico${subjectLine}. Tu trabajo es leer el programa de estudio proporcionado y construir un temario ordenado usando las herramientas disponibles.

Reglas estrictas:
1. Cada tema debe corresponder a una unidad, tema o concepto central que aparezca EXPLÍCITAMENTE en el programa. No inventes temas que no estén allí.
2. Usa títulos cortos y descriptivos (máximo 60 caracteres), en español.
3. Crea los temas en orden lógico de estudio, respetando el orden del programa cuando sea claro.
4. Después de crear los temas, crea hitos (parciales y/o examen_final) que marquen puntos de repaso acumulativo. El campo coversUpToOrder debe ser el índice del último tema incluido en ese hito (0-based). El primer hito cubre desde el tema 0 hasta coversUpToOrder; cada hito siguiente cubre todo lo anterior más los temas nuevos hasta su coversUpToOrder.
5. No crees hitos con coversUpToOrder mayor que el índice del último tema existente.
6. No crees temas de "introducción general", "repaso" o "evaluación" como topics; esos son hitos.
7. Si el programa no tiene suficiente detalle para dividir en temas claros, crea un temario pequeño y conservador (3-7 temas) que refleje lo que SÍ aparece.

Antes de responder con texto final, asegurate de que llamaste a createTopic para cada tema y a createMilestone para cada hito.`;
}

/**
 * Variante EN (locale "en") del prompt system. Mismo contrato de reglas que
 * la variante ES, redactado en inglés nativo. Regla 2 adaptada: los títulos
 * se generan en el idioma preferido del estudiante (interpolado vía
 * `languageName`) — para un tester en-US con material fuente en español, el
 * título que él LEE debe estar en inglés.
 */
function buildTemarioBuilderSystemPromptEn(subjectName?: string): string {
  const subjectLine = subjectName ? ` for ${subjectName}` : "";
  const language = languageName("en");
  return `You are an academic assistant${subjectLine}. Your job is to read the course syllabus provided below and build an ordered course outline using the available tools.

Strict rules:
1. Every topic must correspond to a unit, topic, or core concept that appears EXPLICITLY in the syllabus. Do not invent topics that are not there.
2. Use short, descriptive titles (60 characters max), written in ${language}. Topic titles must always be generated in the student's preferred language — ${language} here — even when the source material is in another language: the title is what the student reads.
3. Create the topics in logical study order, respecting the order of the syllabus when it is clear.
4. After creating the topics, create milestones (midterms and/or a final exam) that mark cumulative review points. coversUpToOrder must be the index of the last topic included in that milestone (0-based). The first milestone covers topics 0 through coversUpToOrder; each later milestone covers everything before it plus the new topics up to its own coversUpToOrder.
5. Never create a milestone whose coversUpToOrder exceeds the index of the last existing topic.
6. Do not create "general introduction", "review", or "assessment" entries as topics; those are milestones.
7. If the syllabus does not provide enough detail to split into clear topics, build a small, conservative outline (3-7 topics) that reflects what IS there.

Before returning your final answer, make sure you called createTopic for every topic and createMilestone for every milestone.`;
}

export function buildTemarioBuilderUserPrompt(input: TemarioBuilderPromptInput): string {
  if (input.locale === "en") {
    const subjectSuffix = input.subjectName ? ` (${input.subjectName})` : "";
    return `Course syllabus${subjectSuffix}:

---
${input.sourceText}
---

Build the outline using the createTopic and createMilestone tools. Remember: only topics that appear in the syllabus, short titles, and milestones with cumulative coversUpToOrder.`;
  }
  return `Programa de estudio${input.subjectName ? ` (${input.subjectName})` : ""}:

---
${input.sourceText}
---

Construí el temario usando las herramientas createTopic y createMilestone. Recordá: solo temas que aparezcan en el programa, títulos cortos, y hitos con coversUpToOrder acumulativo.`;
}