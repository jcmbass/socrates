/**
 * The provider-factory seam — what makes this package's execution wrappers
 * (execution/tutor.ts, execution/structured.ts) testable with ZERO network
 * calls, per the task's hard rule.
 *
 * C7 wraps the AI SDK, it doesn't replace it (§1.1): `streamText`/
 * `generateObject` still come from `ai`. What C7 owns is WHICH
 * `LanguageModel` instance gets handed to them for a given `ModelRef`. This
 * package never constructs a real provider itself (that would mean
 * importing `@ai-sdk/anthropic`/`createAnthropic` and touching
 * `ANTHROPIC_API_KEY` here, which is exactly the "PROHIBIDO usar API keys"
 * rule) — callers (WP5's server, or a test) inject a `ProviderResolver`.
 *
 * In production (WP5), a `ProviderResolver` would look roughly like:
 *   const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 *   const resolver: ProviderResolver = (ref) => {
 *     if (ref.providerId === "anthropic") return anthropic(ref.modelId);
 *     ...
 *   };
 * In tests, it returns `MockLanguageModelV4` instances (`ai/test`) or a
 * `vi.mock("ai", ...)` double — see __tests__/*.
 */
import type { LanguageModel } from "ai";
import type { ModelRef } from "./task";

export type ProviderResolver = (ref: ModelRef) => LanguageModel;
