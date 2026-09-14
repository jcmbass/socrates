/**
 * The ONLY place in apps/server allowed to construct a real AI SDK provider
 * — mirrors `@buxo/models/provider`'s module doc ("PROHIBIDO usar API keys"
 * inside the package itself; the CALLER injects a `ProviderResolver`). Used
 * exclusively by the real boot path (src/index.ts); every test injects a
 * fake resolver instead (see __tests__/support/fake-provider.ts) — this
 * file is never imported by a test.
 *
 * PB2: ANTHROPIC_BASE_URL se normaliza para tolerar el valor canónico
 * `https://api.anthropic.com` (sin `/v1`). El SDK construye
 * `${baseURL}/messages` y sin `/v1` da 404 silencioso.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderResolver } from "@buxo/models/provider";

/**
 * Normaliza ANTHROPIC_BASE_URL: si está seteado y no termina en `/v1`,
 * añade `/v1`. El SDK de Anthropic construye `${baseURL}/messages` y el
 * endpoint real es `https://api.anthropic.com/v1/messages`.
 */
export function normalizeAnthropicBaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.replace(/\/+$/, ""); // strip trailing slashes
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

/** Default DeepInfra OpenAI-compat endpoint — matches provider.ts:36's Ollama pattern. */
export const DEFAULT_DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai";

export function createProductionProviderResolver(
  anthropicApiKey: string | undefined,
  ollamaBaseUrl: string,
  ollamaApiKey: string | undefined,
  anthropicBaseUrl?: string,
  deepinfraBaseUrl?: string,
  deepinfraApiKey?: string,
): ProviderResolver {
  const anthropic = createAnthropic({ apiKey: anthropicApiKey, baseURL: normalizeAnthropicBaseUrl(anthropicBaseUrl) });
  const ollama = createOpenAICompatible({
    baseURL: ollamaBaseUrl,
    name: "ollama",
    ...(ollamaApiKey ? { apiKey: ollamaApiKey } : {}),
  });
  // DeepInfra — candidato Tier-2 de ingesta (Qwen3-VL-30B-A3B-Instruct),
  // pending_gate en el registry (packages/models/registry.ts). Mismo patrón
  // que Ollama: OpenAI-compatible endpoint, apiKey opcional solo si se pasó.
  //
  // supportsStructuredOutputs: true (gate F2, 2026-08-11, decisión del
  // arquitecto). Sin esta bandera el SDK de ai detecta
  // supportsStructuredOutputs=false (openai-compatible dist:457 default false)
  // y DEGRADA generateObject de json_schema a json_object — JSON sin
  // validación de schema server-side. Medido: 18/20 al 1er intento (90%) en
  // el gate del assessor. Con la bandera el SDK envía
  // response_format: {type:"json_schema"} (línea 579) y DeepInfra valida el
  // schema server-side (el catálogo declara structured-output=true).
  //
  // ⚠️ ACOPLAMIENTO: la bandera es POR-PROVEEDOR, no por-modelo — la factory
  // (openai-compatible dist:1814) la aplica a TODO modelo deepinfra. Hoy el
  // impacto es nulo: solo se activa cuando responseFormat.type==="json", y la
  // ingesta usa generateText (nunca setea eso); Qwen3-VL está en "none" y
  // structured.ts lo saltea. Todo modelo deepinfra FUTURO que haga structured
  // output hereda esta afirmación — revisarla si DeepInfra cambia de semántica.
  const deepinfra = createOpenAICompatible({
    baseURL: deepinfraBaseUrl ?? DEFAULT_DEEPINFRA_BASE_URL,
    name: "deepinfra",
    supportsStructuredOutputs: true,
    ...(deepinfraApiKey ? { apiKey: deepinfraApiKey } : {}),
  });

  return (ref) => {
    if (ref.providerId === "anthropic") return anthropic(ref.modelId);
    if (ref.providerId === "ollama") return ollama(ref.modelId);
    if (ref.providerId === "deepinfra") return deepinfra(ref.modelId);
    // Non-Anthropic/Ollama/DeepInfra candidates (OpenRouter/Together/Mistral, §1.6)
    // are all `pending_gate` in the registry today (packages/models/registry.ts) —
    // `isServableForTask` already blocks them from being selected outside
    // dev+explicit-flag, so this branch is unreachable in prod/staging. It
    // throws instead of silently falling through, consistent with C7's
    // fail-loud philosophy (never guess a provider construction).
    throw new Error(
      `No provider construction wired for providerId "${ref.providerId}" (modelId "${ref.modelId}") — ` +
        `this candidate should be pending_gate and therefore unreachable via resolveChain; if it was reached, ` +
        `add its @ai-sdk/* construction here as part of that model's O-14 gate approval.`,
    );
  };
}
