/**
 * socrates design tokens — DESIGN.md at the repo root is the source of
 * truth for these values (originally D2 design tokens, C-cliente-e-
 * ingesta.md §4) as a JS theme object — the RN consumption mechanism
 * DF-5.4 mandates (no CSS in RN; StyleSheet vanilla in WP2, NativeWind
 * deliberately NOT added — less surface, to be re-evaluated under D2).
 *
 * SAME semantic vocabulary as the harness (`apps/harness/app/globals.css`),
 * same light/dark VALUES, so both clients speak one design language:
 * CSS `--color-surface-raised` ↔ JS `colors.surfaceRaised`, etc. If a
 * value changes here it must change there too (D2 §4.7: single source of
 * truth is the goal; extracting these into a shared platform-agnostic
 * token file is deliberate follow-up work, not WP2's).
 *
 * **Dark-mode-first (DESIGN.md §2):** socrates is a dark brand — DARK_COLORS
 * is the design target, LIGHT_COLORS the accessibility/system-preference
 * exception. `useTheme` (theme/useTheme.ts) now defaults to dark unless the
 * OS explicitly reports "light".
 *
 * Accessibility notes baked into values (not left to callers):
 * - `accentContrast` is near-black (`#0d1117`, the brand background) in
 *   dark mode because `accent` (`#58a6ff`) is a LIGHT blue — white text on
 *   it reads ~2.5:1 (fails AA); dark text reads ~7.5:1. Same reasoning the
 *   previous indigo palette used, just flipped which side is dark.
 * - `accentLight`/`warningBg`/`dangerBg` in dark mode are the brand hue
 *   blended ~15-20% into `surface` (opaque hex, not a translucent overlay —
 *   RN `StyleSheet` colors are plain strings). Foreground-on-accentLight
 *   measures ~9.5:1, clearly a tinted surface without washing out.
 * - `elevated` (craft spec §2.1, D1) is the missing rung of the depth
 *   ladder: `surface` -> `surfaceRaised` (cards) -> `elevated`
 *   (hover/pressed/interactive secondary surfaces). Same blend family as
 *   `surfaceRaised`, one step lighter (dark) / one step darker (light) —
 *   moto e13 has no real blur/shadow budget (DESIGN §2), so depth is
 *   communicated ONLY through these tone steps, never elevation shadows.
 * - `successBg` (craft spec §2.1, D1) is the success analogue of
 *   `warningBg`/`dangerBg` — same "brand hue blended into surface" formula,
 *   filling the gap the W3 subagent hit (skill-tree "done" nodes had no
 *   tinted background to sit on, only a bare `success` stroke/check).
 * - Light-mode values follow GitHub's Primer light palette — the same
 *   design family the skill's dark values are drawn from (`#58a6ff`/
 *   `#7ee787`/`#d29922`/`#0d1117`/etc. are Primer's dark theme), already
 *   AA-audited upstream, so the light "exception" stays visually related
 *   to the dark default instead of inventing an unrelated light palette.
 * - Body type ≥17 with 1.5-1.6 line-height (D2 §4.2: long prose on ~6"
 *   screens). Font: Inter, loaded via expo-font/@expo-google-fonts in
 *   `app/_layout.tsx` (DESIGN.md §3 — brand font is no longer an open
 *   question, R-8 of spec C §5 resolved).
 * - `MIN_TOUCH_TARGET = 48` (48dp Material floor, the larger of the two
 *   platform standards — D2 §4.4; DESIGN.md §8's floor is 44px, this
 *   project keeps the stricter 48 as its actual target).
 */

export type ColorSchemeName = "light" | "dark";

export interface ColorTokens {
  /** Page background. CSS: --color-surface */
  surface: string;
  /** Cards / raised panels. CSS: --color-surface-raised */
  surfaceRaised: string;
  /** Hairlines, input borders. CSS: --color-border */
  border: string;
  /** Primary action / brand accent. CSS: --color-accent */
  accent: string;
  /** Text/icons placed ON the accent. CSS: --color-accent-contrast */
  accentContrast: string;
  /** Tinted accent background (chips, selected rows). CSS: --color-accent-light */
  accentLight: string;
  /** Primary text. CSS: --foreground */
  foreground: string;
  /** Secondary/disabled text. CSS: --color-muted */
  muted: string;
  /**
   * Depth rung above `surfaceRaised`: hover/pressed states, interactive
   * secondary surfaces (craft spec §2.1, D1). No CSS var yet in the harness
   * — added here first, port to `apps/harness/app/globals.css` when a
   * consumer needs it there.
   */
  elevated: string;
  /** CSS: --color-success */
  success: string;
  /**
   * Tinted success background — same formula as `warningBg`/`dangerBg`
   * (craft spec §2.1, D1). No CSS var yet, same follow-up note as `elevated`.
   */
  successBg: string;
  /** CSS: --color-warning */
  warning: string;
  /** CSS: --color-warning-bg */
  warningBg: string;
  /** CSS: --color-danger */
  danger: string;
  /** CSS: --color-danger-bg */
  dangerBg: string;
}

/** Light mode — the DESIGN.md §2 exception, not the default. Primer light. */
export const LIGHT_COLORS: ColorTokens = {
  surface: "#ffffff",
  surfaceRaised: "#f6f8fa",
  border: "#d0d7de",
  accent: "#0969da",
  accentContrast: "#ffffff",
  accentLight: "#ddf4ff",
  foreground: "#1f2328",
  muted: "#59636e",
  elevated: "#eaeef2",
  success: "#1a7f37",
  successBg: "#dafbe1",
  warning: "#9a6700",
  warningBg: "#fff8c5",
  danger: "#d1242f",
  dangerBg: "#ffebe9",
};

/** Dark mode — the socrates design target (DESIGN.md §2). */
export const DARK_COLORS: ColorTokens = {
  surface: "#0d1117",
  surfaceRaised: "#161b22",
  border: "#30363d",
  accent: "#58a6ff",
  accentContrast: "#0d1117",
  accentLight: "#162945",
  foreground: "#c9d1d9",
  muted: "#8b949e",
  elevated: "#21262d",
  success: "#7ee787",
  successBg: "#16281c",
  warning: "#d29922",
  warningBg: "#2b2416",
  danger: "#f85149",
  dangerBg: "#301b1f",
};

/**
 * Type scale. `body` is the study-session reading surface (A4: 20-40 min
 * sessions) — 17/26 ≈ 1.53 line-height per D2 §4.2. These are BASE sizes:
 * RN `Text` scales them with the OS font setting because we never disable
 * `allowFontScaling` (default true — D2 §4.6).
 *
 * `letterSpacing` (craft spec §2.2, D1) is in dp — RN has no `em` unit, so
 * these are NOT a direct copy of the skill's em-based table, they're that
 * table's per-size tracking translated to this scale's actual pixel sizes.
 * Apple's rule (apple-design skill §15): tracking is negative on
 * display/title sizes (tightens large type so it doesn't look loose),
 * ~0 on body/small (default reading rhythm), and slightly positive on
 * caption/eyebrow (small all-caps/medium text needs MORE breathing room
 * per glyph to stay legible, not less).
 */
export const typography = {
  /** Long-form reading (tutor prose, inputs). */
  body: { fontSize: 17, lineHeight: 26, letterSpacing: 0 },
  /** Secondary rows, metadata. */
  small: { fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  /** Captions, helper text. */
  caption: { fontSize: 13, lineHeight: 18, letterSpacing: 0.1 },
  /** Screen titles. */
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  /** Hero / welcome heading. Tighter leading than the old 36 (craft spec
   * §2.2: display sizes read better with a snugger line-height). */
  heading: { fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  /**
   * Small uppercase label (craft spec §2.2, D1) — "TEMARIO", "TEMA N",
   * "PARCIAL", "TU RUTA DE APRENDIZAJE" today are hand-rolled per screen;
   * this is the token they migrate to. Pair with `weights.semibold` +
   * `textTransform: "uppercase"` + `colors.muted` (or `colors.accent` for an
   * emphasized eyebrow) at the call site — this object only owns the
   * type-scale part (size/leading/tracking), not color/transform/weight,
   * same division of concerns as every other level here.
   */
  eyebrow: { fontSize: 11, lineHeight: 14, letterSpacing: 1.2 },
  weights: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
  /**
   * socrates brand font (DESIGN.md §3): Inter for headings/body. Loaded via
   * `useFonts` in `app/_layout.tsx` (`@expo-google-fonts/inter`) — RN's
   * `Text` component (0.86, no `defaultProps` support left) has no single
   * global-default mechanism, so each `Text` style must set `fontFamily`
   * explicitly, keyed to the SAME weight used for `fontWeight` (a loaded
   * Google Font is a distinct family per weight, not one family + numeric
   * weight like a variable/system font). Falls back to the OS system font
   * until `useFonts` resolves and on any `Text` not yet migrated to set it.
   */
  fontFamily: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },
  /** JetBrains Mono (DESIGN.md §3) — code/monospace contexts only. KaTeX's
   * own math glyphs are NOT affected (KaTeX_* families, see theme/katexCss.ts). */
  fontFamilyMono: {
    regular: "JetBrainsMono_400Regular",
    medium: "JetBrainsMono_500Medium",
  },
  /**
   * For figures (counts, dates, progress numbers) — D2 §4.2 "numerales
   * tabulares donde aplique". Spread into a Text style:
   * `fontVariant: [...typography.tabularNums]`.
   */
  tabularNums: ["tabular-nums"] as const,
} as const;

/** 4pt-based spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  /** Fully-rounded (pills, send button). */
  full: 999,
} as const;

/**
 * Minimum touch target in dp — D2 §4.4: the larger of iOS HIG 44pt and
 * Material 48dp, adopted as the single cross-platform floor. Every
 * Pressable in this app must reach this in BOTH dimensions.
 */
export const MIN_TOUCH_TARGET = 48;

export interface Theme {
  scheme: ColorSchemeName;
  colors: ColorTokens;
}

export const LIGHT_THEME: Theme = { scheme: "light", colors: LIGHT_COLORS };
export const DARK_THEME: Theme = { scheme: "dark", colors: DARK_COLORS };
