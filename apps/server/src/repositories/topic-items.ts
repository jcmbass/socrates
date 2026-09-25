/**
 * topic_items cache — guided session item batches (plan-sesion-guiada D-S04).
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { topicItems } from "../db/schema";
import {
  GUIDED_ITEMS_GENERATOR_VERSION,
  TOPIC_ITEMS_SCHEMA_VERSION,
  topicItemsLocale,
  type GuidedItemLocale,
  type TopicItemsPayload,
  TopicItemsPayloadSchema,
} from "@buxo/domain/guided-item";
import type { StructuredAdapter } from "@buxo/models/execution/structured";
import type { AccountKind } from "@buxo/domain/user";
import { generateTopicItems, GuidedItemsGenerationError } from "../guided/generate-topic-items";
import { checkGuidedItemsQuota, recordGuidedItemsUsage, GuidedItemsQuotaExceededError, type QuotaConfig } from "../quota/enforce";
import { newId } from "./ids";

export const GUIDED_ITEMS_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
export const GUIDED_ITEMS_CLAIM_ORPHAN_MS = 180 * 1000;
const WAIT_POLL_MS = 25;
/** Must cover a live DeepSeek batch (~60s). 8s made concurrent/retry callers degrade while the winner was still generating. */
const WAIT_TIMEOUT_MS = 90_000;

export interface TopicItemsRecord {
  id: string;
  userId: string;
  subjectId: string;
  topicId: string;
  payload: TopicItemsPayload;
  generatedAt: string;
  schemaVersion: number;
}

function rowToRecord(row: typeof topicItems.$inferSelect): TopicItemsRecord {
  const payload = TopicItemsPayloadSchema.parse(row.payload);
  return {
    id: row.id,
    userId: row.userId,
    subjectId: row.subjectId,
    topicId: row.topicId,
    payload,
    generatedAt: row.generatedAt,
    schemaVersion: row.schemaVersion,
  };
}

export async function findTopicItems(
  db: Db,
  subjectId: string,
  topicId: string,
): Promise<TopicItemsRecord | null> {
  const [row] = await db
    .select()
    .from(topicItems)
    .where(and(eq(topicItems.subjectId, subjectId), eq(topicItems.topicId, topicId)))
    .limit(1);
  if (!row || row.schemaVersion !== TOPIC_ITEMS_SCHEMA_VERSION) return null;
  const parsed = TopicItemsPayloadSchema.safeParse(row.payload);
  return parsed.success ? rowToRecord(row) : null;
}

export interface EnsureTopicItemsInput {
  userId: string;
  subjectId: string;
  topicId: string;
  title: string;
  unitLabel?: string | null;
  sourcesText?: string;
  requireSources: boolean;
  structuredAdapter: StructuredAdapter;
  /**
   * Idioma del estudiante. Omitirlo = "es" (el default de la base instalada):
   * mismo render y mismo schema que antes de la localización. Un batch
   * cacheado en otro idioma deja de contar como fresco y se regenera una vez.
   */
  locale?: GuidedItemLocale;
  now?: Date;
  quota?: {
    accountKind: AccountKind;
    config: QuotaConfig;
  };
}

export type TopicItemsDegradedReason = "generation_failed" | "sources_required";

export type EnsureTopicItemsResult =
  | {
      degraded: false;
      degradedReason: null;
      record: TopicItemsRecord;
      payload: TopicItemsPayload;
      grounding: "sources" | "general";
      generatorVersion: string;
    }
  | {
      degraded: true;
      degradedReason: TopicItemsDegradedReason;
      record: null;
      payload: null;
      grounding: "sources" | "general";
      generatorVersion: string;
    };

type GeneratingPayload = {
  status: "generating";
  claimedAt: string;
  generatorVersion: string;
  grounding: "sources" | "general";
};

type FailedPayload = {
  status: "generation_failed";
  failedAt: string;
  generatorVersion: string;
  grounding: "sources" | "general";
  error?: string;
};

async function findRawTopicItems(db: Db, subjectId: string, topicId: string) {
  const [row] = await db
    .select()
    .from(topicItems)
    .where(and(eq(topicItems.subjectId, subjectId), eq(topicItems.topicId, topicId)))
    .limit(1);
  return row ?? null;
}

function isGenerating(payload: unknown): payload is GeneratingPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as GeneratingPayload;
  return value.status === "generating" && typeof value.claimedAt === "string";
}

function isFailed(payload: unknown): payload is FailedPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as FailedPayload;
  return value.status === "generation_failed" && typeof value.failedAt === "string";
}

function withinMs(iso: string, now: Date, windowMs: number): boolean {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return false;
  return now.getTime() - ts < windowMs;
}

function settledPayload(payload: TopicItemsPayload): TopicItemsPayload {
  const { regeneratingAt: _r, generationFailedAt: _f, ...rest } = payload;
  return rest;
}

function successResult(record: TopicItemsRecord): Extract<EnsureTopicItemsResult, { degraded: false }> {
  const payload = settledPayload(record.payload);
  return {
    degraded: false,
    degradedReason: null,
    record: { ...record, payload },
    payload,
    grounding: payload.grounding,
    generatorVersion: payload.generatorVersion,
  };
}

function degradedResult(
  reason: TopicItemsDegradedReason,
  grounding: "sources" | "general",
): Extract<EnsureTopicItemsResult, { degraded: true }> {
  return {
    degraded: true,
    degradedReason: reason,
    record: null,
    payload: null,
    grounding,
    generatorVersion: GUIDED_ITEMS_GENERATOR_VERSION,
  };
}

/**
 * Un batch cacheado sirve si es de esta versión del generador, no está
 * reclamado, y no hay nada que MEJORAR: ni grounding (general → sources) ni
 * idioma (el del estudiante cambió respecto del que generó el batch).
 *
 * Cuando sí hay algo que mejorar, el cooldown de fallo manda: si el último
 * intento de regenerar falló hace poco, se sigue sirviendo lo que hay en vez
 * de gastar una llamada por request. Esa es la regla que ya existía para el
 * upgrade de grounding; el idioma entra por la misma puerta.
 */
function isFreshSuccess(
  existing: TopicItemsRecord | null,
  grounding: "sources" | "general",
  now: Date,
  locale: GuidedItemLocale,
): boolean {
  if (!existing) return false;
  if (existing.payload.generatorVersion !== GUIDED_ITEMS_GENERATOR_VERSION) return false;
  if (existing.payload.regeneratingAt && withinMs(existing.payload.regeneratingAt, now, GUIDED_ITEMS_CLAIM_ORPHAN_MS)) {
    return false;
  }
  const groundingUpgrade = existing.payload.grounding !== "sources" && grounding === "sources";
  const localeMismatch = topicItemsLocale(existing.payload) !== locale;
  if (!groundingUpgrade && !localeMismatch) return true;
  return Boolean(
    existing.payload.generationFailedAt &&
      withinMs(existing.payload.generationFailedAt, now, GUIDED_ITEMS_FAILURE_COOLDOWN_MS),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireGenerationClaim(
  db: Db,
  input: EnsureTopicItemsInput,
  grounding: "sources" | "general",
  now: Date,
): Promise<{ kind: "acquired"; previous: TopicItemsPayload | null; rowId: string } | { kind: "lost" }> {
  const claimedAt = now.toISOString();
  const generating: GeneratingPayload = {
    status: "generating",
    claimedAt,
    generatorVersion: GUIDED_ITEMS_GENERATOR_VERSION,
    grounding,
  };
  const orphanIso = new Date(now.getTime() - GUIDED_ITEMS_CLAIM_ORPHAN_MS).toISOString();

  const raw = await findRawTopicItems(db, input.subjectId, input.topicId);
  if (!raw) {
    const [inserted] = await db
      .insert(topicItems)
      .values({
        id: newId(),
        userId: input.userId,
        subjectId: input.subjectId,
        topicId: input.topicId,
        payload: generating,
        generatedAt: claimedAt,
        schemaVersion: TOPIC_ITEMS_SCHEMA_VERSION,
      })
      .onConflictDoNothing({ target: [topicItems.subjectId, topicItems.topicId] })
      .returning();
    return inserted ? { kind: "acquired", previous: null, rowId: inserted.id } : { kind: "lost" };
  }

  const success = TopicItemsPayloadSchema.safeParse(raw.payload);
  if (success.success) {
    const [updated] = await db
      .update(topicItems)
      .set({
        payload: { ...success.data, regeneratingAt: claimedAt },
        generatedAt: claimedAt,
      })
      .where(
        and(
          eq(topicItems.id, raw.id),
          sql`coalesce(${topicItems.payload}->>'regeneratingAt', '') < ${orphanIso}`,
        ),
      )
      .returning();
    return updated ? { kind: "acquired", previous: success.data, rowId: raw.id } : { kind: "lost" };
  }

  if (isGenerating(raw.payload) && withinMs(raw.payload.claimedAt, now, GUIDED_ITEMS_CLAIM_ORPHAN_MS)) {
    return { kind: "lost" };
  }

  if (
    isFailed(raw.payload) &&
    raw.payload.generatorVersion === GUIDED_ITEMS_GENERATOR_VERSION &&
    withinMs(raw.payload.failedAt, now, GUIDED_ITEMS_FAILURE_COOLDOWN_MS)
  ) {
    return { kind: "lost" };
  }

  const staleGuard =
    raw.schemaVersion === 1
      ? eq(topicItems.schemaVersion, 1)
      : isGenerating(raw.payload)
        ? sql`${topicItems.payload}->>'claimedAt' < ${orphanIso}`
        : isFailed(raw.payload)
          ? sql`${topicItems.payload}->>'failedAt' < ${new Date(now.getTime() - GUIDED_ITEMS_FAILURE_COOLDOWN_MS).toISOString()}`
          : eq(topicItems.id, raw.id);

  const [updated] = await db
    .update(topicItems)
    .set({
      payload: generating,
      generatedAt: claimedAt,
      schemaVersion: TOPIC_ITEMS_SCHEMA_VERSION,
    })
    .where(and(eq(topicItems.id, raw.id), staleGuard))
    .returning();
  return updated ? { kind: "acquired", previous: null, rowId: raw.id } : { kind: "lost" };
}

async function persistSuccess(db: Db, rowId: string, payload: TopicItemsPayload, now: Date): Promise<TopicItemsRecord> {
  const [updated] = await db
    .update(topicItems)
    .set({
      payload: settledPayload(payload),
      generatedAt: now.toISOString(),
      schemaVersion: TOPIC_ITEMS_SCHEMA_VERSION,
    })
    .where(eq(topicItems.id, rowId))
    .returning();
  if (!updated) throw new Error("persistSuccess: claimed topic_items row missing");
  return rowToRecord(updated);
}

async function persistFailure(
  db: Db,
  rowId: string,
  grounding: "sources" | "general",
  previous: TopicItemsPayload | null,
  now: Date,
  error?: string,
): Promise<void> {
  const failedAt = now.toISOString();
  const payload: TopicItemsPayload | FailedPayload = previous
    ? { ...settledPayload(previous), generationFailedAt: failedAt }
    : {
        status: "generation_failed",
        failedAt,
        generatorVersion: GUIDED_ITEMS_GENERATOR_VERSION,
        grounding,
        ...(error ? { error } : {}),
      };
  await db
    .update(topicItems)
    .set({ payload, generatedAt: failedAt, schemaVersion: TOPIC_ITEMS_SCHEMA_VERSION })
    .where(eq(topicItems.id, rowId));
}

async function releaseClaim(db: Db, rowId: string, previous: TopicItemsPayload | null): Promise<void> {
  if (previous) {
    await db
      .update(topicItems)
      .set({ payload: settledPayload(previous) })
      .where(eq(topicItems.id, rowId));
    return;
  }
  await db.delete(topicItems).where(eq(topicItems.id, rowId));
}

async function waitForClaim(
  db: Db,
  input: EnsureTopicItemsInput,
  grounding: "sources" | "general",
  now: Date,
  locale: GuidedItemLocale,
): Promise<EnsureTopicItemsResult> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(WAIT_POLL_MS);
    const existing = await findTopicItems(db, input.subjectId, input.topicId);
    if (existing && isFreshSuccess(existing, grounding, now, locale)) return successResult(existing);
    const raw = await findRawTopicItems(db, input.subjectId, input.topicId);
    if (
      raw &&
      isFailed(raw.payload) &&
      raw.payload.generatorVersion === GUIDED_ITEMS_GENERATOR_VERSION &&
      withinMs(raw.payload.failedAt, now, GUIDED_ITEMS_FAILURE_COOLDOWN_MS)
    ) {
      return degradedResult("generation_failed", grounding);
    }
    if (raw && isGenerating(raw.payload) && withinMs(raw.payload.claimedAt, now, GUIDED_ITEMS_CLAIM_ORPHAN_MS)) {
      continue;
    }
    if (existing?.payload.regeneratingAt && withinMs(existing.payload.regeneratingAt, now, GUIDED_ITEMS_CLAIM_ORPHAN_MS)) {
      continue;
    }
  }
  const fallback = await findTopicItems(db, input.subjectId, input.topicId);
  if (fallback) return successResult(fallback);
  return degradedResult("generation_failed", grounding);
}

/**
 * Idempotent v2 ensure. Legacy v1 / stale generatorVersion rows regenerate.
 * Concurrent callers take a row claim (unique index or regeneratingAt CAS);
 * losers wait for the winner instead of issuing a second model call.
 */
export async function ensureTopicItems(db: Db, input: EnsureTopicItemsInput): Promise<EnsureTopicItemsResult> {
  const now = input.now ?? new Date();
  const grounding = input.sourcesText?.trim() ? "sources" : "general";
  const locale: GuidedItemLocale = input.locale === "en" ? "en" : "es";
  if (input.requireSources && grounding === "general") {
    return degradedResult("sources_required", grounding);
  }

  const existing = await findTopicItems(db, input.subjectId, input.topicId);
  if (existing && isFreshSuccess(existing, grounding, now, locale)) {
    return successResult(existing);
  }

  const raw = await findRawTopicItems(db, input.subjectId, input.topicId);
  if (
    raw &&
    isFailed(raw.payload) &&
    raw.payload.generatorVersion === GUIDED_ITEMS_GENERATOR_VERSION &&
    withinMs(raw.payload.failedAt, now, GUIDED_ITEMS_FAILURE_COOLDOWN_MS)
  ) {
    return degradedResult("generation_failed", grounding);
  }

  if (input.quota) {
    const quota = await checkGuidedItemsQuota(db, input.userId, input.quota.accountKind, input.quota.config, now);
    if (!quota.ok) throw new GuidedItemsQuotaExceededError();
  }

  const claim = await acquireGenerationClaim(db, input, grounding, now);
  if (claim.kind === "lost") {
    return waitForClaim(db, input, grounding, now, locale);
  }

  let costUsd: number | null = null;
  let calledModel = false;
  try {
    const generated = await generateTopicItems({
      title: input.title,
      unitLabel: input.unitLabel,
      sourcesText: input.sourcesText,
      structuredAdapter: input.structuredAdapter,
      locale,
    });
    calledModel = true;
    costUsd = generated.costUsd;
    if (input.quota) {
      await recordGuidedItemsUsage(db, input.userId, input.quota.accountKind, input.quota.config, costUsd, now);
    }
    const record = await persistSuccess(db, claim.rowId, generated.payload, now);
    return successResult(record);
  } catch (err) {
    if (err instanceof GuidedItemsGenerationError) {
      calledModel = true;
      costUsd = err.costUsd;
    } else if (err instanceof Error && err.message === "generateTopicItems: title is required") {
      await releaseClaim(db, claim.rowId, claim.previous);
      throw err;
    }
    if (calledModel && input.quota) {
      await recordGuidedItemsUsage(db, input.userId, input.quota.accountKind, input.quota.config, costUsd, now);
    }
    if (err instanceof GuidedItemsGenerationError || calledModel) {
      const error = err instanceof GuidedItemsGenerationError ? err.reason : err instanceof Error ? err.message : "unknown";
      console.error("[guided-items] persist generation_failed", {
        subjectId: input.subjectId,
        topicId: input.topicId,
        grounding,
        error,
      });
      await persistFailure(db, claim.rowId, grounding, claim.previous, now, error);
      return degradedResult("generation_failed", grounding);
    }
    await releaseClaim(db, claim.rowId, claim.previous);
    throw err;
  }
}

export { GuidedItemsQuotaExceededError };
