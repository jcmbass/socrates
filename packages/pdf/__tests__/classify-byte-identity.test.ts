import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `classify.ts` is FROZEN per `especificaciones/C-cliente-e-ingesta.md`
 * §3.2 — "classify.ts (heurístico puro) se reusa sin cambios". This wave
 * (F2 WQ2 Part 0a) moved it verbatim from `apps/harness/lib/pdf/` into this
 * shared package; the fixture below is a byte-for-byte snapshot taken at
 * that move. Same pattern as `packages/core/__tests__/prompts.test.ts`'s
 * G1 fixture test: if this fails, the SOURCE changed unexpectedly — the
 * fix belongs in the code (revert the accidental edit), never in the
 * fixture, unless a human/architect explicitly decides to unfreeze the
 * heuristics (in which case the fixture is deliberately updated in the
 * same commit as the decision).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("classify.ts is byte-identical to its frozen golden fixture", () => {
  it("matches __fixtures__/classify.golden.ts.txt exactly", () => {
    const actual = readFileSync(path.join(__dirname, "..", "classify.ts"), "utf8");
    const golden = readFileSync(path.join(__dirname, "__fixtures__", "classify.golden.ts.txt"), "utf8");
    expect(actual).toBe(golden);
  });
});
