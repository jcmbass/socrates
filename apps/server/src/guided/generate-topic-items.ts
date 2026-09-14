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
}

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

export const GeneratedItemSchema = z
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
      if (!optionSet.has("Verdadero") || !optionSet.has("Falso")) {
        ctx.addIssue({ code: "custom", message: "verdadero_falso options must be Verdadero/Falso" });
      }
      if (typeof item.answer !== "string" || !optionSet.has(item.answer)) {
        ctx.addIssue({ code: "custom", message: "verdadero_falso answer must be the string Verdadero or Falso" });
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

export const GeneratedGuidedBatchSchema = z
  .object({ items: z.array(GeneratedItemSchema).min(8).max(8) })
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
  const result = await input.structuredAdapter.generateStructured({
    task: "guided-items",
    system: GUIDED_ITEMS_SYSTEM_PROMPT,
    prompt: buildPrompt(input, grounding),
    schema: GeneratedGuidedBatchSchema,
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
  });
  return { payload, costUsd: result.costUsd };
}
