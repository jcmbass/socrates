/**
 * Fuente — text-only study material for a subject.
 *
 * The original PDF/image binary is discarded after ingestion; only the
 * extracted text is persisted. Scoped to `(userId, subjectId)` and reusable
 * across all topics and milestones of that subject.
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const FUENTE_KINDS = ["pdf", "image"] as const;
export type FuenteKind = (typeof FUENTE_KINDS)[number];

export interface Fuente {
  id: string;
  subjectId: string;
  userId: string;
  /** Display label (e.g. original filename), not a path. */
  name: string;
  kind: FuenteKind;
  /** Extracted text content — the only persisted representation. */
  text: string;
  /** Optional context-window budget estimate. */
  tokens?: number;
  createdAt: string;
  schemaVersion: number;
}

const FuenteBaseSchema = z.object({
  id: idSchema,
  subjectId: idSchema,
  userId: idSchema,
  name: z.string().min(1),
  kind: z.enum(FUENTE_KINDS),
  text: z.string(),
  tokens: z.number().int().min(0).optional(),
  createdAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});

export const FuenteSchema: z.ZodType<Fuente> = FuenteBaseSchema;

/** Strict schema used by the text-only invariant to reject binary/storage fields. */
export const FuenteTextOnlySchema = FuenteBaseSchema.strict();

export function newFuenteId(now: Date = new Date()): string {
  const compact = now.toISOString().replace(/[-:]/g, "").replace(/\./g, "");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${compact}-s${suffix}`;
}

export function emptyFuente(input: {
  id?: string;
  subjectId: string;
  userId: string;
  name: string;
  kind: FuenteKind;
  text: string;
  tokens?: number;
  now?: Date;
}): Fuente {
  const now = input.now ?? new Date();
  return {
    id: input.id ?? newFuenteId(now),
    subjectId: input.subjectId,
    userId: input.userId,
    name: input.name,
    kind: input.kind,
    text: input.text,
    tokens: input.tokens,
    createdAt: now.toISOString(),
    schemaVersion: 1,
  };
}

export function serializeFuente(fuente: Fuente): string {
  return JSON.stringify(fuente, null, 2);
}

export function parseFuente(value: unknown): Fuente {
  return FuenteSchema.parse(value);
}

export function deserializeFuente(json: string): Fuente {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Fuente JSON is not valid");
  }
  return parseFuente(parsed);
}
