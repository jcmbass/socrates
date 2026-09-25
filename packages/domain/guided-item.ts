/**
 * Guided session items — sesión guiada (plan-sesion-guiada D-S03/D-S04).
 *
 * Server-generated cache per topic (`topic_items.payload`). Pure shapes +
 * zod validation; no I/O.
 */
import { z } from "zod";
import { idSchema } from "./common";

export const GUIDED_ITEM_TYPES = ["elige", "verdadero_falso", "completa", "expose"] as const;
export type GuidedItemType = (typeof GUIDED_ITEM_TYPES)[number];

export const GUIDED_DIFFICULTIES = [1, 2, 3] as const;
export type GuidedDifficulty = (typeof GUIDED_DIFFICULTIES)[number];

export const GUIDED_GROUNDING_VALUES = ["sources", "general"] as const;
export type GuidedGrounding = (typeof GUIDED_GROUNDING_VALUES)[number];

export const GUIDED_ITEMS_GENERATOR_VERSION = "guided-items-v3";
export const TOPIC_ITEMS_SCHEMA_VERSION = 2;

/** Correct answer: option index (0-based) or literal string (e.g. V/F). */
export const GuidedItemAnswerSchema = z.union([z.string(), z.number().int().min(0)]);

export interface GuidedItem {
  id: string;
  type: GuidedItemType;
  difficulty: GuidedDifficulty;
  prompt: string;
  options: string[];
  answer: string | number;
  explanation: string;
}

export const GuidedItemSchema: z.ZodType<GuidedItem> = z.object({
  id: idSchema,
  type: z.enum(GUIDED_ITEM_TYPES),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  prompt: z.string().min(1),
  options: z.array(z.string()),
  answer: GuidedItemAnswerSchema,
  explanation: z.string().min(1),
});

/** Idiomas en los que se puede generar un batch (catálogo del producto). */
export const GUIDED_ITEM_LOCALES = ["es", "en"] as const;
export type GuidedItemLocale = (typeof GUIDED_ITEM_LOCALES)[number];

/** JSON persisted in `topic_items.payload`. */
export interface TopicItemsPayload {
  items: GuidedItem[];
  grounding: GuidedGrounding;
  generatorVersion: string;
  /**
   * Idioma en el que se generó el batch. OPCIONAL a propósito: las filas
   * escritas antes de la localización de la sesión guiada (2026-09-18) no lo
   * traen y se leen como "es" — que es literalmente el idioma en el que se
   * generaron. Sin este campo, un estudiante que cambia de idioma seguiría
   * recibiendo para siempre el batch cacheado en el idioma anterior.
   */
  locale?: GuidedItemLocale;
  /** In-flight regeneration claim (CAS). Absent on a settled cache row. */
  regeneratingAt?: string;
  /** Last failed generation while this success payload is still servable (upgrade cooldown). */
  generationFailedAt?: string;
}

export const TopicItemsPayloadSchema: z.ZodType<TopicItemsPayload> = z.object({
  items: z.array(GuidedItemSchema).min(1).max(10),
  grounding: z.enum(GUIDED_GROUNDING_VALUES),
  generatorVersion: z.string().min(1),
  locale: z.enum(GUIDED_ITEM_LOCALES).optional(),
  regeneratingAt: z.string().min(1).optional(),
  generationFailedAt: z.string().min(1).optional(),
});

/** Idioma efectivo de un batch cacheado — ausencia = "es" (ver `locale`). */
export function topicItemsLocale(payload: TopicItemsPayload): GuidedItemLocale {
  return payload.locale ?? "es";
}

export function parseGuidedItem(value: unknown): GuidedItem {
  return GuidedItemSchema.parse(value);
}

export function parseTopicItemsPayload(value: unknown): TopicItemsPayload {
  return TopicItemsPayloadSchema.parse(value);
}

/** Client-safe item shape — `answer` is withheld until after submit. */
export type GuidedItemPublic = Omit<GuidedItem, "answer">;

export function stripGuidedItemAnswer(item: GuidedItem): GuidedItemPublic {
  const { answer: _answer, ...rest } = item;
  return rest;
}

export function stripGuidedItemAnswers(items: GuidedItem[]): GuidedItemPublic[] {
  return items.map(stripGuidedItemAnswer);
}
