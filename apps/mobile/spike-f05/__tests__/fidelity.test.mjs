/**
 * Offline tests for spike-f05/fidelity.mjs — pure functions, no PDF/WebView
 * involved (LECCIONES-Y-BUGS pattern 2/4: pure logic gets exhaustive
 * offline tests; only the real glue needs on-device verification).
 *
 * Uses Node's built-in test runner (not vitest) deliberately: this file
 * lives under the gitignored/eslint-ignored spike-f05/ tree, and keeping
 * it fully self-contained (no vitest.config.ts include-glob change needed)
 * avoids touching the app's real test wiring for throwaway code.
 *
 * Run: node --test apps/mobile/spike-f05/__tests__/fidelity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFidelity,
  levenshteinDistance,
  normalizedSimilarity,
  normalizeForComparison,
  stripNonTier0Content,
} from "../fidelity.mjs";

test("levenshteinDistance: identical strings", () => {
  assert.equal(levenshteinDistance("hello", "hello"), 0);
});

test("levenshteinDistance: empty strings", () => {
  assert.equal(levenshteinDistance("", ""), 0);
  assert.equal(levenshteinDistance("abc", ""), 3);
  assert.equal(levenshteinDistance("", "abc"), 3);
});

test("levenshteinDistance: classic kitten/sitting example", () => {
  assert.equal(levenshteinDistance("kitten", "sitting"), 3);
});

test("normalizeForComparison: collapses whitespace and lowercases", () => {
  assert.equal(normalizeForComparison("  Hola   Mundo\n\n"), "hola mundo");
});

test("normalizedSimilarity: identical (after normalization) strings score 1", () => {
  assert.equal(normalizedSimilarity("Hola  Mundo", "hola mundo"), 1);
});

test("normalizedSimilarity: completely different strings of equal length score 0", () => {
  const sim = normalizedSimilarity("aaaa", "bbbb");
  assert.equal(sim, 0);
});

test("normalizedSimilarity: both-empty scores 1 (vacuously identical)", () => {
  assert.equal(normalizedSimilarity("", ""), 1);
});

test("stripNonTier0Content: removes mocked-cloud lines", () => {
  const input = [
    "Texto local de la página 1.",
    "⟦F05-MOCK-CLOUD⟧ (mode=page) texto canario fijo.",
    "Más texto local.",
  ].join("\n");
  const out = stripNonTier0Content(input);
  assert.ok(!out.includes("F05-MOCK-CLOUD"));
  assert.ok(out.includes("Texto local de la página 1."));
  assert.ok(out.includes("Más texto local."));
});

test("stripNonTier0Content: removes [Figura: ...] spans but keeps surrounding text", () => {
  const input = "Antes del [Figura: un diagrama de la célula] después de la figura.";
  const out = stripNonTier0Content(input);
  assert.ok(!out.includes("Figura"));
  assert.ok(out.includes("Antes del"));
  assert.ok(out.includes("después de la figura."));
});

test("computeFidelity: passes at exactly the threshold and above", () => {
  const reference = "El gato come pescado todos los días en la mañana.";
  const extracted = reference; // perfect Tier-0 extraction, no cloud content
  const result = computeFidelity(extracted, reference);
  assert.equal(result.pass, true);
  assert.equal(result.similarity, 1);
});

test("computeFidelity: fails below 95% and reports the shortfall honestly", () => {
  const reference = "a".repeat(100);
  const extracted = "a".repeat(80) + "b".repeat(20); // 20% char mismatch -> similarity 0.8
  const result = computeFidelity(extracted, reference);
  assert.equal(result.pass, false);
  assert.ok(result.similarityPercent < 95);
});

test("computeFidelity: mocked-cloud content in the extracted material does not inflate or deflate the Tier-0 score", () => {
  const reference = "Texto local de referencia exacto.";
  const extractedWithCloudNoise =
    "Texto local de referencia exacto.\n⟦F05-MOCK-CLOUD⟧ (mode=page) ruido totalmente distinto que no debería contar.";
  const result = computeFidelity(extractedWithCloudNoise, reference);
  assert.equal(result.pass, true);
  assert.equal(result.similarity, 1);
});
