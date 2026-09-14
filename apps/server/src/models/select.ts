/**
 * The one branch point between the real `ModelAdapters` (real
 * @ai-sdk/anthropic + real "ai" streamText/generateObject) and
 * `BUXO_FAKE_MODELS`'s fake one (models/fake-adapters.ts — zero "ai"
 * imports, zero network calls). Factored out of src/index.ts so this
 * branch is unit-testable without index.ts's top-level side effects
 * (binds a port, opens a real pg.Pool) — see __tests__/boot/fake-models.test.ts.
 *
 * `env.BUXO_FAKE_MODELS && env.BUXO_ENV !== "dev"` can never reach this
 * function: `readEnv` (src/env.ts) already throws at parse time via its
 * `superRefine` — that's the actual fail-loud gate. This function does not
 * re-check it; it only decides which adapters to build.
 */
import type { ResolvedModelsConfig } from "@buxo/models/config";
import { toModelsEnvironment, type ServerEnv } from "../env";
import { createModelAdapters, type ModelAdapters } from "./adapters";
import { createProductionProviderResolver } from "./provider";
import { createFakeModelAdapters } from "./fake-adapters";

export const FAKE_MODELS_BANNER = [
  "",
  "=".repeat(72),
  "  BUXO_FAKE_MODELS=1 -- MODO DEV DE MODELOS FAKE ACTIVO",
  "  Tutor/assessor/judge sirven respuestas enlatadas. CERO llamadas a",
  "  Anthropic/OpenRouter/etc. NO usar para validar calidad de producto",
  "  -- solo para integracion E2E offline (F1/WP6).",
  "=".repeat(72),
  "",
].join("\n");

/** Loud, impossible-to-miss boot log — printed exactly once, from src/index.ts, before the server starts accepting requests. */
export function logFakeModelsBanner(): void {
  console.log(FAKE_MODELS_BANNER);
}

export function buildModelAdapters(env: ServerEnv, config: ResolvedModelsConfig): ModelAdapters {
  const environment = toModelsEnvironment(env);

  if (env.BUXO_FAKE_MODELS) {
    return createFakeModelAdapters(config, environment);
  }

  return createModelAdapters({
    config,
    resolveProvider: createProductionProviderResolver(
      env.ANTHROPIC_API_KEY,
      env.OLLAMA_BASE_URL,
      env.OLLAMA_API_KEY,
      env.ANTHROPIC_BASE_URL,
      env.DEEPINFRA_BASE_URL,
      env.DEEPINFRA_API_KEY,
    ),
    environment,
    tutorPromptVersion: env.BUXO_TUTOR_PROMPT_VERSION,
  });
}
