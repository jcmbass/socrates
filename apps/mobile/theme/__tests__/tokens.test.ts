import { describe, expect, it } from "vitest";

import { DARK_COLORS, DARK_THEME, LIGHT_COLORS, LIGHT_THEME, typography } from "../tokens";

// Pins the socrates brand palette (DESIGN.md §2 at the repo root) so a
// future edit that drifts from the skill's dark-mode table fails loudly.
// DARK_COLORS is the exact table from the brand skill; LIGHT_COLORS is the
// documented Primer-light exception (see tokens.ts doc comment).
describe("DARK_COLORS (socrates default palette)", () => {
  it("matches the brand skill's dark-mode table", () => {
    expect(DARK_COLORS.surface).toBe("#0d1117");
    expect(DARK_COLORS.surfaceRaised).toBe("#161b22");
    expect(DARK_COLORS.border).toBe("#30363d");
    expect(DARK_COLORS.accent).toBe("#58a6ff");
    expect(DARK_COLORS.success).toBe("#7ee787");
    expect(DARK_COLORS.warning).toBe("#d29922");
    expect(DARK_COLORS.foreground).toBe("#c9d1d9");
    expect(DARK_COLORS.muted).toBe("#8b949e");
  });

  it("keeps accentContrast dark, not white, since accent is a light blue", () => {
    // #58a6ff on white text measures ~2.5:1 (fails WCAG AA) — the token
    // must stay a dark color so text placed on `accent` stays legible.
    expect(DARK_COLORS.accentContrast).not.toBe("#ffffff");
  });

  // Craft spec §2.1 (D1): the depth rung above surfaceRaised, and the
  // success analogue of warningBg/dangerBg — pinned so a future edit can't
  // silently drop or drift these without failing loudly.
  it("has the D1 depth/tint tokens (elevated, successBg)", () => {
    expect(DARK_COLORS.elevated).toBe("#21262d");
    expect(DARK_COLORS.successBg).toBe("#16281c");
  });
});

describe("LIGHT_COLORS (accessibility/system-preference exception)", () => {
  it("is a distinct light palette (not just an alias of dark)", () => {
    expect(LIGHT_COLORS.surface).not.toBe(DARK_COLORS.surface);
    expect(LIGHT_COLORS.surface.toLowerCase()).toBe("#ffffff");
    expect(LIGHT_COLORS.accentContrast).toBe("#ffffff");
  });

  it("has the D1 depth/tint tokens (elevated, successBg)", () => {
    expect(LIGHT_COLORS.elevated).toBe("#eaeef2");
    expect(LIGHT_COLORS.successBg).toBe("#dafbe1");
  });
});

// Craft spec §2.2 (D1): tracking-per-size + the new `eyebrow` level. Pinned
// the same way the palette above is pinned — a future edit that drifts
// from the spec's table fails loudly here instead of silently in a screen.
describe("typography (D1 tracking + eyebrow)", () => {
  it("heading is tighter-leading with negative tracking (display size)", () => {
    expect(typography.heading).toEqual({ fontSize: 28, lineHeight: 34, letterSpacing: -0.5 });
  });

  it("body/small keep ~0 tracking", () => {
    expect(typography.body.letterSpacing).toBe(0);
    expect(typography.small.letterSpacing).toBe(0);
  });

  it("caption has slight positive tracking", () => {
    expect(typography.caption.letterSpacing).toBe(0.1);
  });

  it("exposes the new eyebrow level (small uppercase label)", () => {
    expect(typography.eyebrow).toEqual({ fontSize: 11, lineHeight: 14, letterSpacing: 1.2 });
  });
});

describe("theme objects", () => {
  it("wire scheme to the matching color table", () => {
    expect(DARK_THEME.scheme).toBe("dark");
    expect(DARK_THEME.colors).toBe(DARK_COLORS);
    expect(LIGHT_THEME.scheme).toBe("light");
    expect(LIGHT_THEME.colors).toBe(LIGHT_COLORS);
  });
});
