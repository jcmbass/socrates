/**
 * Central C7 wiring point — the one place apps/server constructs
 * `TutorAdapter`/`StructuredAdapter` from `@buxo/models`. Both prod boot
 * (src/index.ts, real `ProviderResolver`) and every test (fake
 * `ProviderResolver`/mocked `ai`) go through this same factory, so the
 * wiring itself is exercised by tests, not just its inputs.
 */
import type { ResolvedModelsConfig } from "@buxo/models/config";
import type { ProviderResolver } from "@buxo/models/provider";
import type { Environment } from "@buxo/models/task";
import type { TelemetrySink } from "@buxo/models/telemetry";
import { NoopTelemetrySink } from "@buxo/models/telemetry";
import { createTutorAdapter, type TutorAdapter } from "@buxo/models/execution/tutor";
import { createMilestoneAdapter, type MilestoneAdapter } from "@buxo/models/execution/milestone";
import { createStructuredAdapter, type StructuredAdapter } from "@buxo/models/execution/structured";
import { createIngestAdapter, type IngestAdapter } from "@buxo/models/execution/ingest";
import { createTemarioBuilderAdapter, type TemarioBuilderAdapter } from "@buxo/models/execution/temario-builder";

export interface ModelAdapters {
  tutorAdapter: TutorAdapter;
  /** P5 (DF-P05) — the milestone review-round adapter, `@buxo/models/execution/milestone`. Opt-in, separate prompt/version from the tutor's (R2) — see that module's doc for why it's a distinct file rather than a `TutorAdapter` variant. */
  milestoneAdapter: MilestoneAdapter;
  /** Shared-telemetry structured adapter — used where per-call cost capture isn't needed. */
  structuredAdapter: StructuredAdapter;
  /** P2 — adapter agéntico de construcción de temarios vía tools. */
  temarioBuilderAdapter: TemarioBuilderAdapter;
  /** Raw pieces, re-exposed so models/assess.ts and models/judge.ts can build a PER-CALL adapter+sink for cost capture (see their module docs). */
  raw: ModelDeps;
}

export interface ModelDeps {
  config: ResolvedModelsConfig;
  resolveProvider: ProviderResolver;
  environment: Environment;
  /**
   * Per-call `StructuredAdapter` factory — models/assess.ts and
   * models/judge.ts each build a FRESH `StructuredAdapter` per call (for
   * cost capture, see their module docs) via this factory instead of
   * importing `@buxo/models/execution/structured`'s `createStructuredAdapter`
   * directly. That indirection is what lets `BUXO_FAKE_MODELS` dev mode
   * (models/fake-adapters.ts) swap in a fake structured adapter — which
   * never calls the real `generateObject`/`"ai"` — without either caller
   * needing to know which one it got. `createModelAdapters` below wires the
   * real one; `createFakeModelAdapters` wires the fake one.
   */
  createStructuredAdapter: (telemetry: TelemetrySink) => StructuredAdapter;
  /**
   * Same per-call-factory pattern as `createStructuredAdapter` above, for
   * F2 WQ1's ingest (Tier-2 page transcription) task — `models/ingest.ts`
   * builds a fresh `IngestAdapter` per call for cost capture (§2.5 ingest
   * quota accounting). `createModelAdapters` wires the real one;
   * `createFakeModelAdapters` wires a canned one (mocked in every test —
   * zero model-API calls per this wave's hard rule).
   */
  createIngestAdapter: (telemetry: TelemetrySink) => IngestAdapter;
}

export interface CreateModelAdaptersInput {
  config: ResolvedModelsConfig;
  resolveProvider: ProviderResolver;
  environment: Environment;
  telemetry?: TelemetrySink;
  /** Beta externa (BE2): versión del prompt del tutor. Default buxo-socratic-v3. */
  tutorPromptVersion?: "buxo-socratic-v3" | "buxo-socratic-v4";
}

export function createModelAdapters(input: CreateModelAdaptersInput): ModelAdapters {
  const telemetry = input.telemetry ?? new NoopTelemetrySink();
  return {
    tutorAdapter: createTutorAdapter({
      config: input.config,
      resolveProvider: input.resolveProvider,
      environment: input.environment,
      telemetry,
      promptVersion: input.tutorPromptVersion,
    }),
    milestoneAdapter: createMilestoneAdapter({
      config: input.config,
      resolveProvider: input.resolveProvider,
      environment: input.environment,
      telemetry,
    }),
    structuredAdapter: createStructuredAdapter({
      config: input.config,
      resolveProvider: input.resolveProvider,
      environment: input.environment,
      telemetry,
    }),
    temarioBuilderAdapter: createTemarioBuilderAdapter({
      config: input.config,
      resolveProvider: input.resolveProvider,
      environment: input.environment,
      telemetry,
    }),
    raw: {
      config: input.config,
      resolveProvider: input.resolveProvider,
      environment: input.environment,
      createStructuredAdapter: (perCallTelemetry) =>
        createStructuredAdapter({
          config: input.config,
          resolveProvider: input.resolveProvider,
          environment: input.environment,
          telemetry: perCallTelemetry,
        }),
      createIngestAdapter: (perCallTelemetry) =>
        createIngestAdapter({
          config: input.config,
          resolveProvider: input.resolveProvider,
          environment: input.environment,
          telemetry: perCallTelemetry,
        }),
    },
  };
}
