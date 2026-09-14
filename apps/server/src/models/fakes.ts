/**
 * Shared fake model doubles — promoted out of
 * `__tests__/support/fake-provider.ts` (F1/WP6 Part 1) so BOTH the test
 * suite AND the `BUXO_FAKE_MODELS` dev boot path (models/fake-adapters.ts,
 * models/select.ts) share the exact same doubles instead of each defining
 * their own. `__tests__/support/fake-provider.ts` now just re-exports this
 * module — no test file's imports had to change.
 *
 * `fakeProviderResolver` alone is only safe to use in a TEST, because it
 * only fakes the `LanguageModel` object handed to a REAL `streamText`/
 * `generateObject` call — every test that injects it ALSO mocks `"ai"`'s
 * `streamText`/`generateObject` at the module level
 * (`vi.mock("ai", ...)`), so those real functions are never actually
 * invoked. A running server can't module-mock `"ai"` — that's why
 * `BUXO_FAKE_MODELS` mode (models/fake-adapters.ts) builds a completely
 * separate `ModelAdapters` that never imports `"ai"` at all, rather than
 * just injecting this resolver into the real adapters.
 */
import type { LanguageModel } from "ai";
import type { ProviderResolver } from "@buxo/models/provider";

export function fakeModel(): LanguageModel {
  return { modelId: "fake" } as unknown as LanguageModel;
}

export const fakeProviderResolver: ProviderResolver = () => fakeModel();

/**
 * Deterministic, dependency-free string hash (djb2 variant) — used by
 * models/fake-adapters.ts to pick a canned reply/verdict deterministically
 * from arbitrary input text (same input -> same output, per Part 1's
 * "deterministic structured outputs for assessor/judge" requirement, and
 * useful for the tutor's canned replies too so repeated test runs are
 * reproducible). Never used for anything security-sensitive.
 */
export function deterministicIndex(seed: string, modulo: number): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  // >>> 0 forces an unsigned 32-bit value before the modulo.
  return (hash >>> 0) % Math.max(1, modulo);
}
