/**
 * Re-exports the fake `ProviderResolver` every test injects — the doubles
 * themselves now live in `src/models/fakes.ts` (a non-test module) so
 * `BUXO_FAKE_MODELS` dev mode (src/models/fake-adapters.ts) can reuse them
 * too, without duplicating them (F1/WP6 Part 1). This file is kept so no
 * existing test import path had to change.
 */
export { fakeModel, fakeProviderResolver } from "../../src/models/fakes";
