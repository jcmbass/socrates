/**
 * Maps `ServerEnv`'s `BUXO_*_CHAIN` vars onto `@buxo/models`'
 * `RawModelsConfig` shape. Split out from `src/index.ts` so the fail-loud
 * boot invariant (a malformed/unregistered chain throws at `loadModelsConfig`
 * time) can be exercised directly in tests without importing `index.ts`
 * itself (which has top-level side effects — binds a port, opens a real
 * Postgres pool — and is therefore not safely importable in a test file).
 */
import type { ServerEnv } from "../env";
import type { RawModelsConfig, ResolvedModelsConfig } from "@buxo/models/config";

function cleanChain(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function modelsRawConfigFromEnv(env: ServerEnv): RawModelsConfig {
  return {
    tutor: cleanChain(env.BUXO_TUTOR_CHAIN),
    assessor: cleanChain(env.BUXO_ASSESSOR_CHAIN),
    judge: cleanChain(env.BUXO_JUDGE_CHAIN),
    ingest: cleanChain(env.BUXO_INGEST_CHAIN),
    safety: cleanChain(env.BUXO_SAFETY_CHAIN),
    temarioBuilder: cleanChain(env.BUXO_TEMARIO_BUILDER_CHAIN),
    masteryAssessor: cleanChain(env.BUXO_MASTERY_ASSESSOR_CHAIN),
    guidedItems: cleanChain(env.BUXO_GUIDED_ITEMS_CHAIN),
  };
}

/**
 * Closed beta serves general-knowledge guided items. An empty chain in
 * staging/prod would degrade every topic with HTTP 200 — fail at boot instead.
 */
export function assertGuidedItemsChainReady(env: ServerEnv, config: ResolvedModelsConfig): void {
  if (env.BUXO_ENV === "dev" || env.BUXO_FAKE_MODELS || env.BUXO_GUIDED_REQUIRE_SOURCES) return;
  if (config.chains["guided-items"].length > 0) return;
  throw new Error(
    `guided-items chain is empty in ${env.BUXO_ENV} while BUXO_GUIDED_REQUIRE_SOURCES is off. ` +
      `Set BUXO_GUIDED_ITEMS_CHAIN=deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731 and ` +
      `BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE=1 ` +
      `(allowPendingGate=${env.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE}, ` +
      `chainConfigured=${Boolean(cleanChain(env.BUXO_GUIDED_ITEMS_CHAIN))}).`,
  );
}
