import { describe, expect, it } from "vitest";
import { en } from "../../i18n/en";
import { t } from "../../i18n/es";

/**
 * Copy-length guard for the home StatsStrip / subject-card strings (C2-e).
 *
 * WHY a character ceiling instead of a layout test: the real constraint is
 * `StreakDisplay` rendering `courses.streak.none` with `numberOfLines={1}`
 * inside StatsStrip — the strip's actual width depends on fontScale, screen
 * size and the sibling stat, so no character count "promises" a fit. What a
 * length guard DOES promise is that a copy edit can't quietly re-introduce
 * the truncation C2-e fixed: the old copy ("Todavía no hay racha — cada
 * explicación cuenta" = 46 chars, "No streak yet — every explanation
 * counts" = 40) was cut mid-sentence on typical device widths.
 *
 * The numbers:
 * - `streak.none`: ceiling 24 — the new copy is 13 chars in BOTH locales,
 *   so 24 is ~1.8× the shipped text while still ~half the old 46-char copy
 *   that truncated; anything longer than that reads as a sentence, which is
 *   exactly what this slot can't hold on one line.
 * - `streak.broken`: same StatsStrip surface, copy unchanged in C2-e
 *   (39 chars es / 38 en). Ceiling 48 = measured copy + headroom (~23%), so
 *   a future edit can grow a little but cannot double into a sentence.
 *
 * This is a copy guard, NOT a layout guarantee — a genuine fit check needs
 * the render (C4 QA captures es/en dark).
 */
describe("i18nLength (C2-e — guardia de copy para superficies de una línea)", () => {
  it("courses.streak.none stays under the 24-char ceiling in both locales", () => {
    expect(t.courses.streak.none.length, `es '${t.courses.streak.none}'`).toBeLessThanOrEqual(24);
    expect(en.courses.streak.none.length, `en '${en.courses.streak.none}'`).toBeLessThanOrEqual(24);
  });

  it("the C2-e rewrite is strictly shorter than the copy it replaced", () => {
    // Pin the OLD lengths so a future "restore the long copy" edit fails
    // here first, with the reason, instead of regressing the strip silently.
    expect(t.courses.streak.none.length).toBeLessThan("Todavía no hay racha — cada explicación cuenta".length);
    expect(en.courses.streak.none.length).toBeLessThan("No streak yet — every explanation counts".length);
  });

  it("courses.streak.broken stays under its 48-char ceiling in both locales", () => {
    expect(t.courses.streak.broken.length, `es '${t.courses.streak.broken}'`).toBeLessThanOrEqual(48);
    expect(en.courses.streak.broken.length, `en '${en.courses.streak.broken}'`).toBeLessThanOrEqual(48);
  });

  it("coldStart.bootLines rotate one short line (≤ 40) with the same count in both locales", () => {
    expect(t.coldStart.bootLines.length).toBeGreaterThanOrEqual(3);
    expect(en.coldStart.bootLines.length).toBe(t.coldStart.bootLines.length);
    for (const line of [...t.coldStart.bootLines, ...en.coldStart.bootLines]) {
      expect(line.length, `'${line}'`).toBeLessThanOrEqual(40);
    }
  });

  it("subject.materialInEnglish stays a short caption (≤ 24) in both locales", () => {
    expect(t.subject.materialInEnglish.length, `es '${t.subject.materialInEnglish}'`).toBeLessThanOrEqual(24);
    expect(en.subject.materialInEnglish.length, `en '${en.subject.materialInEnglish}'`).toBeLessThanOrEqual(24);
  });
});