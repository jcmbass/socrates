#!/usr/bin/env node
/**
 * SPIKE F0.5 (ingestion memory gate) — offline Tier-0 fidelity scorer.
 *
 * THROWAWAY, per
 * docs/plan-app-multiplataforma/especificaciones/C-cliente-e-ingesta.md
 * §2.5: "Fidelidad del texto local (Tier-0) | ≥95% de similitud de
 * caracteres (p.ej. distancia de Levenshtein normalizada) contra la
 * porción correspondiente de docs/guia1.txt, tras normalizar
 * espacios/mayúsculas | Comparación textual automatizada, offline".
 *
 * Usage:
 *   node spike-f05/fidelity.mjs <extracted.txt> <reference.txt>
 *
 * `<extracted.txt>` is the `materialText` field of a `SpikeResult` (either
 * pasted from the on-screen results panel or reassembled from the
 * `F05_SPIKE_RESULT` logcat chunks, see `lib/spikeF05Bridge.ts`'s
 * `chunkForLogcat`/`LOGCAT_MARKER`). It is expected to still contain the
 * mocked-cloud markers (`⟦F05-MOCK-CLOUD⟧`) and `[Figura: ...]` spans —
 * this script strips BOTH before scoring, because §2.5 gates the LOCAL
 * (Tier-0) text specifically, not the (mocked, not-really-transcribed)
 * cloud portions.
 *
 * Similarity = 1 - (levenshtein(a, b) / max(len(a), len(b))), computed
 * after normalizing whitespace runs to a single space, trimming, and
 * lowercasing both strings (per §2.5's "tras normalizar
 * espacios/mayúsculas").
 */
import { readFileSync } from "node:fs";

/** Removes every `⟦F05-MOCK-CLOUD⟧...` mocked-transcribe line and every `[Figura: ...]` span — both are cloud-tier output, not Tier-0, and must not count toward Tier-0 fidelity. */
export function stripNonTier0Content(text) {
  return text
    .split("\n")
    .filter((line) => !line.includes("⟦F05-MOCK-CLOUD⟧"))
    .join("\n")
    .replace(/\[Figura:[^\]]*\]/g, "");
}

/** §2.5: "tras normalizar espacios/mayúsculas". */
export function normalizeForComparison(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Classic O(n*m) DP Levenshtein distance — guia1.txt is 7.5KB, well within a cheap single-pass budget for a one-off offline script. */
export function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost, // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
}

/** Normalized similarity in [0, 1]; 1 = identical after normalization. */
export function normalizedSimilarity(a, b) {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(na, nb);
  return 1 - dist / maxLen;
}

/**
 * Full pipeline: strip cloud-tier content from `extractedMaterial`, then
 * score against `referenceText` (docs/guia1.txt). Returns both the raw
 * similarity ratio and a §2.5 pass/fail against the 95% threshold.
 */
export function computeFidelity(extractedMaterial, referenceText, thresholdRatio = 0.95) {
  const tier0Only = stripNonTier0Content(extractedMaterial);
  const similarity = normalizedSimilarity(tier0Only, referenceText);
  return {
    similarity,
    similarityPercent: Math.round(similarity * 10000) / 100,
    pass: similarity >= thresholdRatio,
    thresholdRatio,
    tier0CharsAfterStrip: normalizeForComparison(tier0Only).length,
    referenceChars: normalizeForComparison(referenceText).length,
  };
}

function main() {
  const [, , extractedPath, referencePath] = process.argv;
  if (!extractedPath || !referencePath) {
    console.error("Usage: node spike-f05/fidelity.mjs <extracted.txt> <reference.txt>");
    process.exit(2);
  }
  const extracted = readFileSync(extractedPath, "utf8");
  const reference = readFileSync(referencePath, "utf8");
  const result = computeFidelity(extracted, reference);
  console.log(JSON.stringify(result, null, 2));
  console.log(
    result.pass
      ? `PASS — ${result.similarityPercent}% >= ${result.thresholdRatio * 100}%`
      : `FAIL — ${result.similarityPercent}% < ${result.thresholdRatio * 100}%`,
  );
  process.exit(result.pass ? 0 : 1);
}

// Only run the CLI when this file is executed directly (`node fidelity.mjs
// ...`), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
