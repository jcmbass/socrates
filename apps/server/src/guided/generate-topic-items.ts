/** Grounded DeepInfra generator for guided-session items. */
import { z } from "zod";
import {
  type GuidedItem,
  type GuidedGrounding,
  type TopicItemsPayload,
  GUIDED_ITEMS_GENERATOR_VERSION,
  TopicItemsPayloadSchema,
} from "@buxo/domain/guided-item";
import type { StructuredAdapter } from "@buxo/models/execution/structured";
import { deterministicIndex } from "../models/fakes";

export interface GenerateTopicItemsInput {
  title: string;
  unitLabel?: string | null;
  sourcesText?: string;
  structuredAdapter: StructuredAdapter;
  /**
   * Idioma del estudiante (`users.preferredLanguageCode`, normalizado en
   * `routes/guided.ts`). Omitirlo = "es", el default de la base instalada:
   * ese render queda BYTE-IDÉNTICO al histórico y usa el mismo objeto de
   * schema, igual que el patrón `hardened`/`locale` de `@buxo/core/prompts`.
   */
  locale?: GuidedLocale;
}

export type GuidedLocale = "es" | "en";

/**
 * Etiquetas de `verdadero_falso` por idioma. El generador y el validador
 * TIENEN que usar el mismo par: el schema exige las dos opciones exactas, así
 * que traducirlas en el prompt sin traducirlas acá haría fallar el batch
 * completo (y la sesión guiada degradaría en vez de mostrarse en inglés).
 */
const TRUE_FALSE_OPTIONS: Record<GuidedLocale, readonly [string, string]> = {
  es: ["Verdadero", "Falso"],
  en: ["True", "False"],
};

export class GuidedItemsGenerationError extends Error {
  readonly costUsd: number | null;
  readonly reason: string;
  constructor(costUsd: number | null, reason = "unknown") {
    super("guided_items_generation_failed");
    this.name = "GuidedItemsGenerationError";
    this.costUsd = costUsd;
    this.reason = reason;
  }
}

/** Curriculum membership/relevance tautologies — not conceptual “relación entre X e Y”. */
const CURRICULUM_NOUN = String.raw`(?:unidad(?! de)|materia|asignatura|temario|tema)`;
const THIS_CURRICULUM = String.raw`(?:esta|este) ${CURRICULUM_NOUN}`;
const META_PROMPT_RE = new RegExp(
  [
    String.raw`foco de estudio`,
    String.raw`cu[aá]l (es|opci[oó]n describe mejor) el foco`,
    String.raw`c[oó]mo estudiar`,
    String.raw`dentro de ${THIS_CURRICULUM}`,
    String.raw`fuera de ${THIS_CURRICULUM}`,
    String.raw`pertenece al temario`,
    String.raw`pertenece a ${THIS_CURRICULUM}`,
    String.raw`no pertenece (?:al temario|a ${THIS_CURRICULUM})`,
    String.raw`(?:no )?forma parte (?:del temario|de ${THIS_CURRICULUM})`,
    String.raw`corresponde a ${THIS_CURRICULUM}`,
    String.raw`tema relevante`,
    String.raw`(?:no )?(?:es|est[aá]) relevante (?:para|en) ${THIS_CURRICULUM}`,
    String.raw`no se (?:estudia|enseña)n?\b`,
    String.raw`\bse (?:estudia|enseña)n? en ${THIS_CURRICULUM}`,
    String.raw`tema que (?:no )?se (?:estudia|enseña)n?\b`,
    String.raw`no (?:tiene|guarda|hay) (?:nada |ninguna )?relaci[oó]n con ${THIS_CURRICULUM}`,
    String.raw`tiene relaci[oó]n con ${THIS_CURRICULUM}`,
    String.raw`no se relaciona con ${THIS_CURRICULUM}`,
    String.raw`no (?:est[aá]|es) relacionad[oa]s? con ${THIS_CURRICULUM}`,
    String.raw`nada que ver con ${THIS_CURRICULUM}`,
  ].join("|"),
  "i",
);
const STUDIES_RE = /\b(?:estudia|enseña)n?\b/i;
const THIS_CURRICULUM_RE = new RegExp(THIS_CURRICULUM, "i");

function isMetaOrMembershipPrompt(prompt: string): boolean {
  if (META_PROMPT_RE.test(prompt)) return true;
  return STUDIES_RE.test(prompt) && THIS_CURRICULUM_RE.test(prompt);
}

function fold(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values.map(fold)).size === values.length;
}

function answerText(item: { type: string; options: string[]; answer: string | number }): string {
  if (typeof item.answer === "number") return item.options[item.answer] ?? "";
  return String(item.answer);
}

/** Caps keep the 8-item JSON inside ~1800 output tokens without clipping a useful 2–3 sentence expose. */
export const GENERATED_ITEM_MAX_PROMPT_CHARS = 600;
export const GENERATED_ITEM_MAX_EXPLANATION_CHARS = 500;
export const GENERATED_ITEM_MAX_OPTION_CHARS = 160;
export const GUIDED_ITEMS_MAX_OUTPUT_TOKENS = 1800;
export const GUIDED_ITEMS_CALL_TIMEOUT_MS = 75_000;

function isValidChoiceAnswer(item: { options: string[]; answer: string | number }): boolean {
  if (typeof item.answer === "number") {
    return Number.isInteger(item.answer) && item.answer >= 0 && item.answer < item.options.length;
  }
  return item.options.includes(item.answer);
}

/**
 * Validador de un ítem para un idioma dado. Lo único que cambia entre
 * idiomas son las etiquetas literales de `verdadero_falso`; el resto de las
 * reglas (tipos, conteos, unicidad, anti-tautología) es estructural.
 *
 * LÍMITE CONOCIDO: `isMetaOrMembershipPrompt` solo reconoce las fórmulas
 * tautológicas en español. Para "en" la guardia queda inerte — se deja así a
 * propósito: un patrón nuevo mal calibrado rechazaría el batch entero y la
 * sesión guiada degradaría a "sin ítems", que es peor que una pregunta
 * mediocre. Anotado como deuda en DEVLOG.
 */
function buildGeneratedItemSchema(locale: GuidedLocale) {
  const [trueLabel, falseLabel] = TRUE_FALSE_OPTIONS[locale];
  return z
    .object({
      type: z.enum(["elige", "verdadero_falso", "completa", "expose"]),
      difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      prompt: z.string().min(8).max(GENERATED_ITEM_MAX_PROMPT_CHARS),
      options: z.array(z.string().min(1).max(GENERATED_ITEM_MAX_OPTION_CHARS)).max(4),
      answer: z.union([z.string(), z.number().int().min(0)]),
      explanation: z.string().min(12).max(GENERATED_ITEM_MAX_EXPLANATION_CHARS),
    })
    .superRefine((item, ctx) => {
      if (isMetaOrMembershipPrompt(item.prompt)) {
        ctx.addIssue({ code: "custom", message: "meta/tautological prompt" });
      }
      if (fold(item.explanation) === fold(item.prompt)) {
        ctx.addIssue({ code: "custom", message: "explanation repeats the prompt" });
      }
      if (item.type === "expose") {
        if (item.options.length !== 0 || item.answer !== "") {
          ctx.addIssue({ code: "custom", message: "expose must have options=[] and answer=''" });
        }
        return;
      }
      if (!uniqueStrings(item.options)) {
        ctx.addIssue({ code: "custom", message: "options must be unique" });
      }
      const expectedOptions = item.type === "verdadero_falso" ? 2 : item.type === "elige" ? 4 : 3;
      if (item.options.length !== expectedOptions) {
        ctx.addIssue({ code: "custom", message: `${item.type} must have ${expectedOptions} options` });
      }
      if (item.type === "verdadero_falso") {
        const optionSet = new Set(item.options);
        if (!optionSet.has(trueLabel) || !optionSet.has(falseLabel)) {
          ctx.addIssue({ code: "custom", message: `verdadero_falso options must be ${trueLabel}/${falseLabel}` });
        }
        if (typeof item.answer !== "string" || !optionSet.has(item.answer)) {
          ctx.addIssue({
            code: "custom",
            message: `verdadero_falso answer must be the string ${trueLabel} or ${falseLabel}`,
          });
        }
      } else if (!isValidChoiceAnswer(item)) {
        ctx.addIssue({
          code: "custom",
          message: `${item.type} answer must be a 0-based option index or the exact option text`,
        });
      }
      const correct = fold(answerText(item));
      if (correct && (fold(item.explanation) === correct || fold(item.prompt) === correct)) {
        ctx.addIssue({ code: "custom", message: "explanation/prompt must not merely repeat the answer" });
      }
    });
}

function buildGeneratedGuidedBatchSchema(locale: GuidedLocale) {
  return z
    .object({ items: z.array(buildGeneratedItemSchema(locale)).min(8).max(8) })
    .superRefine((batch, ctx) => {
      const types = new Set(batch.items.map((item) => item.type));
      const exposeCount = batch.items.filter((item) => item.type === "expose").length;
      if (exposeCount !== 2) {
        ctx.addIssue({ code: "custom", message: "batch must contain exactly 2 expose items" });
      }
      for (const required of ["elige", "verdadero_falso", "completa"] as const) {
        if (!types.has(required)) {
          ctx.addIssue({ code: "custom", message: `batch must include at least one ${required}` });
        }
      }
      const prompts = batch.items.map((item) => fold(item.prompt));
      if (new Set(prompts).size !== prompts.length) {
        ctx.addIssue({ code: "custom", message: "prompts must be unique" });
      }
      const explanations = batch.items.map((item) => fold(item.explanation));
      if (new Set(explanations).size !== explanations.length) {
        ctx.addIssue({ code: "custom", message: "explanations must be unique" });
      }
    });
}

/**
 * Un schema POR IDIOMA, construido una sola vez. La identidad importa: el
 * adapter estructurado lo pasa tal cual al proveedor y los tests comparan con
 * `toBe`, así que el render "es" tiene que seguir siendo EL MISMO objeto que
 * antes de la localización.
 */
const GUIDED_BATCH_SCHEMAS: Record<GuidedLocale, ReturnType<typeof buildGeneratedGuidedBatchSchema>> = {
  es: buildGeneratedGuidedBatchSchema("es"),
  en: buildGeneratedGuidedBatchSchema("en"),
};

const GUIDED_ITEM_SCHEMAS: Record<GuidedLocale, ReturnType<typeof buildGeneratedItemSchema>> = {
  es: buildGeneratedItemSchema("es"),
  en: buildGeneratedItemSchema("en"),
};

/** Schema del idioma fundacional — el histórico, exportado para los tests. */
export const GeneratedItemSchema = GUIDED_ITEM_SCHEMAS.es;
export const GeneratedGuidedBatchSchema = GUIDED_BATCH_SCHEMAS.es;

export function generatedGuidedBatchSchemaFor(locale: GuidedLocale) {
  return GUIDED_BATCH_SCHEMAS[locale];
}

export type GeneratedGuidedBatch = z.infer<typeof GeneratedGuidedBatchSchema>;

export const GUIDED_ITEMS_SYSTEM_PROMPT = [
  "Eres un diseñador pedagógico. Devuelve únicamente el objeto JSON solicitado por el schema.",
  "Crea exactamente 8 elementos: 2 exposiciones breves (máximo 2-3 frases cada una) y luego preguntas de comprensión y aplicación. Preguntas y explicaciones concisas.",
  "Cada exposición enseña una idea concreta del tema (hecho, relación, mecanismo o ejemplo); nunca describas cómo estudiar ni digas que el tema es importante.",
  "Las preguntas deben poder contestarse con el contenido expuesto o las fuentes. Prohíbe preguntas meta, tautológicas o de pertenencia/relevancia curricular: si un contenido «no se estudia», «pertenece», «es relevante» o «no tiene relación con esta unidad/materia». Pregunta el concepto (definición, mecanismo, relación entre ideas), no si forma parte del temario.",
  "Incluye elige (4 opciones), verdadero_falso (opciones Verdadero/Falso) y completa (3 opciones). Varía la posición y el tipo de la respuesta correcta.",
  "Para elige y completa, answer es el índice 0-based o el texto exacto de la opción correcta. Para verdadero_falso, answer es exactamente Verdadero o Falso.",
  "Cada distractor debe ser plausible y cada explicación debe justificar por qué la respuesta es correcta con contenido, no repetirla.",
  "Si hay fuentes, usa solo hechos respaldados por ellas. No inventes citas ni nombres de fuente.",
].join("\n");

/**
 * Variante en inglés del prompt del generador (bug del 2026-09-18: la sesión
 * guiada era española incondicional aunque el estudiante tuviera
 * `preferredLanguageCode = "en"`).
 *
 * Se reemplazan las DOS líneas que nombran etiquetas literales
 * (`verdadero_falso` → True/False) y se agrega una instrucción de idioma
 * explícita al final: el resto de las reglas pedagógicas se mantienen en
 * español a propósito — son instrucciones para el modelo, no texto que el
 * estudiante vea, y reescribirlas sería un prompt nuevo sin validar en vez de
 * el mismo prompt con una regla de idioma (misma disciplina que
 * `buildLanguageSection` en @buxo/core/prompts).
 */
const GUIDED_ITEMS_SYSTEM_PROMPT_EN = [
  ...GUIDED_ITEMS_SYSTEM_PROMPT.split("\n").map((line) =>
    line
      .replace("verdadero_falso (opciones Verdadero/Falso)", "verdadero_falso (opciones True/False)")
      .replace("answer es exactamente Verdadero o Falso", "answer es exactamente True o False"),
  ),
  "Language: the student's preferred language is English. Write EVERY student-facing string — prompt, options and explanation — in English. The `type` values stay in Spanish because they are schema keys, and the verdadero_falso options must be exactly True and False.",
].join("\n");

/**
 * Prompt del generador para un idioma. `locale` "es" (u omitido) devuelve el
 * constante histórico, byte por byte.
 */
export function guidedItemsSystemPrompt(locale: GuidedLocale = "es"): string {
  return locale === "en" ? GUIDED_ITEMS_SYSTEM_PROMPT_EN : GUIDED_ITEMS_SYSTEM_PROMPT;
}

function guidedItemId(seed: string, index: number): string {
  const slot = deterministicIndex(`${seed}:id:${index}`, 0xffff_ffff);
  return `gi-${slot.toString(16).padStart(8, "0")}-${index}`;
}

function buildPrompt(input: GenerateTopicItemsInput, grounding: GuidedGrounding): string {
  const title = input.title.trim();
  const unit = input.unitLabel?.trim() || "(sin etiqueta de unidad)";
  const context =
    grounding === "sources"
      ? `Fuentes autorizadas:\n${input.sourcesText}`
      : "No hay Fuentes. Usa conocimiento general estable y ampliamente aceptado; evita datos dudosos o demasiado específicos.";
  return `Tema: ${title}\nUnidad: ${unit}\nGrounding: ${grounding}\n\n${context}`;
}

export interface GeneratedTopicItemsResult {
  payload: TopicItemsPayload;
  costUsd: number | null;
}

/** One logical structured call; the shared adapter retries invalid output once. */
export async function generateTopicItems(input: GenerateTopicItemsInput): Promise<GeneratedTopicItemsResult> {
  const title = input.title.trim();
  if (!title) throw new Error("generateTopicItems: title is required");
  const grounding: GuidedGrounding = input.sourcesText?.trim() ? "sources" : "general";
  const locale: GuidedLocale = input.locale === "en" ? "en" : "es";
  const result = await input.structuredAdapter.generateStructured({
    task: "guided-items",
    system: guidedItemsSystemPrompt(locale),
    prompt: buildPrompt(input, grounding),
    schema: generatedGuidedBatchSchemaFor(locale),
    promptVersion: GUIDED_ITEMS_GENERATOR_VERSION,
    maxOutputTokens: GUIDED_ITEMS_MAX_OUTPUT_TOKENS,
    timeoutMs: GUIDED_ITEMS_CALL_TIMEOUT_MS,
  });
  if (!result.ok) {
    console.error("[guided-items] structured call failed", { error: result.error, costUsd: result.costUsd });
    throw new GuidedItemsGenerationError(result.costUsd, result.error);
  }

  const seed = `${title}:${input.unitLabel?.trim() ?? ""}:${grounding}:${GUIDED_ITEMS_GENERATOR_VERSION}`;
  const items: GuidedItem[] = result.object.items.map((item, index) => ({
    ...item,
    id: guidedItemId(seed, index),
  }));
  const payload = TopicItemsPayloadSchema.parse({
    items,
    grounding,
    generatorVersion: GUIDED_ITEMS_GENERATOR_VERSION,
    // Se escribe SIEMPRE (también para "es"): la fila cacheada tiene que
    // decir en qué idioma se generó, o un cambio de idioma sirve el batch
    // viejo para siempre. Las filas previas a este fix no lo traen y se leen
    // como "es", que es exactamente lo que son.
    locale,
  });
  return { payload, costUsd: result.costUsd };
}
