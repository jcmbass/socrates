/**
 * IngestAdapter — C-backend-plataforma.md §1.1's fourth C7 task
 * ("Ingesta-visión ... Visión + texto/structured, ya usa Haiku hoy"),
 * generalized from `apps/harness/lib/ingest/ingest.ts`'s `runIngest` onto
 * the same chain/failover/telemetry machinery `execution/tutor.ts` and
 * `execution/structured.ts` already use.
 *
 * Built for F2 WQ1 (`docs/plan-app-multiplataforma/05-plan-f2.md`, Ola 1):
 * `apps/server`'s server-side rasterization endpoint needs to transcribe a
 * SINGLE rasterized page image via vision — the harness's `ingestPdf`/
 * `ingestImage` wrap `streamText` directly against `anthropicProvider`
 * (bypassing C7 entirely, a pre-C7 shortcut); this module is the C7-native
 * equivalent apps/server actually calls, so the ingest task's chain,
 * fallback, and cost telemetry are exercised the same way tutor/assessor/
 * judge already are, instead of a fourth bespoke model-calling path.
 *
 * `generateText` (not `streamText`, unlike the harness): the server-side
 * caller (apps/server/src/models/ingest.ts) needs the FULL transcription
 * text back before it can merge it into the digested material and persist
 * a `ProcessingReport` row — nothing consumes it incrementally the way the
 * tutor's `toTextStreamResponse()` is consumed by the client. `ai`'s
 * `generateText` is the non-streaming counterpart, same package the rest of
 * this repo already depends on.
 *
 * Failure contract: THROWS `ModelChainExhaustedError` once the entire chain
 * (including the non-configurable floor) is exhausted — mirrors
 * `execution/tutor.ts`, not `execution/structured.ts`'s degrade-to-null.
 * Rationale: unlike assessor/judge (which have a long-established
 * never-block-the-turn contract, §1.3), a failed transcription has no safe
 * silent degradation — `apps/harness/lib/pdf/orchestrate.ts`'s own
 * `processCloudPage` already treats a transcribe failure as caller-visible
 * (try/catch around the call, honest failure marker in its place) rather
 * than a value the marker-of-failure can't distinguish from "cheap and
 * free". The apps/server caller catches this per-page, same shape.
 */
import { generateText } from "ai";
import type { ResolvedModelsConfig } from "../config";
import { resolveChain } from "../config";
import { runChainWithFailover } from "../failover";
import type { ModelRef, Environment } from "../task";
import type { ProviderResolver } from "../provider";
import type { TelemetrySink } from "../telemetry";
import { NoopTelemetrySink } from "../telemetry";
import { estimateCostUsd } from "../capabilities";
import { ModelChainExhaustedError } from "../errors";

export interface IngestCallParams {
  /** Raw bytes of the rasterized page (or figure crop) PNG/JPEG. */
  imageBytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg";
  /** Transcription instruction — apps/server owns the actual prompt text (see src/models/ingest-prompt.ts). */
  prompt: string;
  /** O-9 provenance — forwarded verbatim into the result, same pattern as `StructuredCallParams.promptVersion`. */
  promptVersion: string;
}

export interface IngestTranscription {
  text: string;
  servedBy: ModelRef;
  promptVersion: string;
}

export interface IngestAdapter {
  transcribeImage(params: IngestCallParams): Promise<IngestTranscription>;
}

export interface CreateIngestAdapterDeps {
  config: ResolvedModelsConfig;
  resolveProvider: ProviderResolver;
  environment: Environment;
  telemetry?: TelemetrySink;
}

/**
 * Quita la cerca de bloque que el modelo de visión pone ALREDEDOR DE TODA su
 * salida (` ```markdown … ``` `). Medido 2026-08-02: aparecía en 72 de las 429
 * páginas del libro de prueba (17%) y llegó a persistirse dentro del material
 * de estudio real, así que el estudiante veía "```markdown" al abrir su Fuente.
 *
 * SOLO se quita cuando la etiqueta es `markdown`/`md`. Deliberadamente NO se
 * quitan cercas sin etiqueta ni con otro lenguaje: una página de un libro de
 * programación puede ser legítimamente UN SOLO bloque de código (el propio
 * Cormen tiene pseudocódigo), y desenvolverla destruiría su formato. Ningún
 * material real se envuelve a sí mismo en una cerca `markdown`.
 */
export function stripOuterMarkdownFence(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith("```") || !t.endsWith("```") || t.length < 8) return raw;
  const nl = t.indexOf("\n");
  if (nl === -1) return raw;
  const tag = t.slice(3, nl).trim().toLowerCase();
  if (tag !== "markdown" && tag !== "md") return raw;
  // Si adentro sobrevive otra cerca de apertura, la de afuera podía ser un
  // bloque real y no un envoltorio — ante la duda, no se toca.
  const inner = t.slice(nl + 1, t.length - 3);
  if (inner.includes("```")) return raw;
  return inner.trim();
}


export function createIngestAdapter(deps: CreateIngestAdapterDeps): IngestAdapter {
  const telemetry = deps.telemetry ?? new NoopTelemetrySink();

  // P1 provider-agnostic seam: the vision transcription provider is selected
  // from the registry via `resolveChain(deps.config, "ingest")`. Candidates
  // without `vision: true` are skipped. To use a local vLLM/OCR provider,
  // register it and set BUXO_INGEST_CHAIN; this file stays unchanged.
  return {
    async transcribeImage(params: IngestCallParams): Promise<IngestTranscription> {
      const chain = resolveChain(deps.config, "ingest");
      const callStartedAt = Date.now();

      const outcome = await runChainWithFailover({
        chain,
        task: "ingest",
        environment: deps.environment,
        telemetry,
        // §1.3.1 only names a same-model retry for structured-output
        // validation failures (assessor/judge) — a vision transcription has
        // no schema to invalidate, so a failure advances straight to the
        // next chain candidate, same as the tutor's streaming call.
        sameModelRetries: 0,
        // A candidate with no vision support at all cannot transcribe an
        // image no matter what — skip it rather than burning a real attempt
        // (mirrors execution/structured.ts's structuredOutputSupport skip).
        skip: (capabilities) => !capabilities.vision,
        attempt: async ({ ref, capabilities }) => {
          const model = deps.resolveProvider(ref);
          const { text, usage } = await generateText({
            model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", image: params.imageBytes, mediaType: params.mediaType },
                  { type: "text", text: params.prompt },
                ],
              },
            ],
          });
          if (text.trim().length === 0) {
            throw new Error(`ingest: model ${ref.providerId}:${ref.modelId} returned an empty transcription`);
          }
          return { text, usage, capabilities };
        },
      });

      if (!outcome.ok) {
        throw new ModelChainExhaustedError("ingest", [...chain], outcome.lastError);
      }

      const { text, usage, capabilities } = outcome.result;
      const servedByRef = outcome.servedBy;
      const inputTokens = usage?.inputTokens ?? null;
      const outputTokens = usage?.outputTokens ?? null;

      telemetry.record({
        type: "model_call",
        task: "ingest",
        environment: deps.environment,
        servedBy: servedByRef,
        attemptIndex: outcome.attemptIndex,
        latencyMs: Date.now() - callStartedAt,
        inputTokens,
        outputTokens,
        cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
        cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? null,
        costUsd: estimateCostUsd(capabilities, inputTokens ?? 0, outputTokens ?? 0),
        promptVersion: params.promptVersion,
        timestamp: new Date().toISOString(),
      });

      return { text: stripOuterMarkdownFence(text), servedBy: servedByRef, promptVersion: params.promptVersion };
    },
  };
}
