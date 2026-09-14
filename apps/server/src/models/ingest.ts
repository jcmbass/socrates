/**
 * Ingest (Tier-2 page transcription) call — F2 WQ1, mirrors
 * `models/assess.ts`/`models/judge.ts`'s per-call-adapter pattern (a FRESH
 * `IngestAdapter` + `InMemoryTelemetrySink` built per call, via
 * `ModelDeps.createIngestAdapter`, so this module can read back `costUsd`
 * for §2.5's ingest quota accounting — see `models/assess.ts`'s module doc
 * for why that's the only way to recover cost without editing
 * `packages/models`'s telemetry-consuming return shape).
 *
 * Unlike assessor/judge's degrade-to-null contract, a failed transcription
 * THROWS (via `@buxo/models/execution/ingest`'s `ModelChainExhaustedError`)
 * — the caller (`../materials/pipeline.ts`) catches it per-page and leaves
 * an honest failure marker in that page's spot, mirroring
 * `apps/harness/lib/pdf/orchestrate.ts`'s `processCloudPage` try/catch.
 */
import { InMemoryTelemetrySink } from "@buxo/models/telemetry";
import type { ModelRef } from "@buxo/models/task";
import type { ModelDeps } from "./adapters";
import { INGEST_PROMPT_VERSION, resolveIngestPagePrompt } from "./ingest-prompt";

export interface TranscribePageInput {
  pngBytes: Uint8Array;
  subject?: string;
}

export interface TranscribePageOutcome {
  text: string;
  servedBy: ModelRef;
  costUsd: number | null;
}

export async function transcribePage(
  modelDeps: Pick<ModelDeps, "createIngestAdapter">,
  input: TranscribePageInput,
): Promise<TranscribePageOutcome> {
  const telemetry = new InMemoryTelemetrySink();
  const adapter = modelDeps.createIngestAdapter(telemetry);

  const result = await adapter.transcribeImage({
    imageBytes: input.pngBytes,
    mediaType: "image/png",
    prompt: resolveIngestPagePrompt(input.subject),
    promptVersion: INGEST_PROMPT_VERSION,
  });

  const costUsd = telemetry.events.find((e) => e.type === "model_call")?.costUsd ?? null;

  return { text: result.text, servedBy: result.servedBy, costUsd };
}
