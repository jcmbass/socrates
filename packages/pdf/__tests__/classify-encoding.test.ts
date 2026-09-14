import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyPage,
  DEFAULT_THRESHOLDS,
  hasSuspiciousEncoding,
} from "../classify";
import type { NormalizedPage, TextItem } from "../types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): NormalizedPage {
  return JSON.parse(
    readFileSync(
      path.join(__dirname, "__fixtures__", "classify", name),
      "utf8",
    ),
  ) as NormalizedPage;
}

function textItem(overrides: Partial<TextItem>): TextItem {
  return {
    str: "word",
    x: 0,
    y: 700,
    width: 20,
    height: 10,
    fontName: "Helvetica",
    ...overrides,
  };
}

function page(textItems: TextItem[]): NormalizedPage {
  return {
    pageNumber: 1,
    width: 612,
    height: 792,
    textItems,
    images: [],
    paths: { horizontalSegments: 0, verticalSegments: 0, rectangles: 0 },
  };
}

describe("hasSuspiciousEncoding / classify encoding gate", () => {
  it("guiaVA3 p2 (acute-separated accents, formulaScore under threshold) → cloud-page encoding", () => {
    const fixture = loadFixture("guiaVA3-p2.json");
    const result = classifyPage(fixture);
    expect(result.signals.suspiciousEncoding).toBe(true);
    expect(result.formulaScore).toBeLessThan(DEFAULT_THRESHOLDS.formulaScore);
    expect(result.route).toEqual({ kind: "cloud-page", reason: "encoding" });
    // Concrete measured corruption still present in the fixture text.
    const joined = fixture.textItems.map((t) => t.str).join("");
    expect(joined).toMatch(/´/);
  });

  it("prosa-bio stays local-text (no false positive on clean Spanish-less prose)", () => {
    const result = classifyPage(loadFixture("prosa-bio-p1.json"));
    expect(result.signals.suspiciousEncoding).toBe(false);
    expect(result.route).toEqual({ kind: "local-text" });
  });

  it("quimica p1/p8 keep non-encoding routes (precomposed accents are fine)", () => {
    const p1 = classifyPage(loadFixture("quimica-p1.json"));
    const p8 = classifyPage(loadFixture("quimica-p8.json"));
    expect(p1.signals.suspiciousEncoding).toBe(false);
    expect(p8.signals.suspiciousEncoding).toBe(false);
    expect(p1.route.kind).not.toBe("cloud-page");
    // p8 may be local-text or local-text-with-figures depending on images
    // in the fixture; it must NOT be forced to encoding.
    if (p8.route.kind === "cloud-page") {
      expect(p8.route.reason).not.toBe("encoding");
    }
  });

  it("detects spacing acute, PUA (≥3), C0 controls, and Instructorís", () => {
    expect(
      hasSuspiciousEncoding([textItem({ str: "soluci´on" })]),
    ).toBe(true);
    expect(
      hasSuspiciousEncoding([textItem({ str: "C ´ ALCULO" })]),
    ).toBe(true);
    expect(
      hasSuspiciousEncoding([textItem({ str: "compa˜nia" })]),
    ).toBe(true);
    expect(
      hasSuspiciousEncoding([
        textItem({ str: "\uF8F1" }),
        textItem({ str: "\uF8F2" }),
        textItem({ str: "\uF8F3" }),
      ]),
    ).toBe(true);
    // Single cosmetic PUA (slide copyright) must NOT trip the gate.
    expect(hasSuspiciousEncoding([textItem({ str: "\uF0E3" })])).toBe(false);
    expect(hasSuspiciousEncoding([textItem({ str: "x\x02y" })])).toBe(true);
    expect(
      hasSuspiciousEncoding([textItem({ str: "Instructorís Manual" })]),
    ).toBe(true);
    // Short Spanish ís must not false-positive.
    expect(hasSuspiciousEncoding([textItem({ str: "el país andino" })])).toBe(
      false,
    );
    expect(
      hasSuspiciousEncoding([textItem({ str: "Cálculo multivariable" })]),
    ).toBe(false);
  });

  it("routes synthetic encoding page to cloud even with low formulaScore", () => {
    const textItems = [
      textItem({ str: "Determine el conjunto soluci´on", x: 80, y: 700 }),
      textItem({ str: "del n´umero de cr´ıas.", x: 80, y: 680 }),
    ];
    const result = classifyPage(page(textItems));
    expect(result.formulaScore).toBeLessThan(DEFAULT_THRESHOLDS.formulaScore);
    expect(result.route).toEqual({ kind: "cloud-page", reason: "encoding" });
  });
});
