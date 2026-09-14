/**
 * Tutor model IDs for the Socratic tutor (design context: preparation for the
 * Haiku gate — makes the model configurable per env without code changes).
 *
 * Aligned with the pattern in lib/ingest/model.ts (INGEST_MODEL_IDS),
 * but kept separate because the ingestion model defaults to Haiku while
 * the tutor/judge models default to Sonnet.
 */
export const TUTOR_MODEL_IDS = {
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
} as const;

export type ModelKey = keyof typeof TUTOR_MODEL_IDS;

/**
 * Resolve a model key from an environment variable value.
 * Validates the value against TUTOR_MODEL_IDS keys and throws a clear
 * error on unknown values (same fail-loud philosophy as assertApiKeyConfigured).
 *
 * Pure function: no side effects, no access to process.env.
 */
export function resolveModelKey(
  envValue: string | undefined,
  fallback: ModelKey,
): ModelKey {
  if (envValue === undefined || envValue === "") return fallback;
  if (envValue in TUTOR_MODEL_IDS) return envValue as ModelKey;
  throw new Error(
    `Invalid model key: "${envValue}". Must be one of: ${Object.keys(TUTOR_MODEL_IDS).join(", ")}.`,
  );
}
