/**
 * StreakDisplay — R-4: superficie discreta y honesta de la racha del
 * estudiante en la pantalla de cursos (A2).
 *
 * Tres estados visuales (sin racha / activa / rota) con tono B2 §6
 * anti-punitivo — sin drama, sin celebrar excesivamente.
 *
 * **Animación de incremento** (apple-design skill §3-4):
 * - Cuando el contador cambia, escala con un spring críticamente amortiguado
 *   (damping 1.0, response 0.4) — interrumpible por diseño (los springs de RN
 *   arrancan desde el valor actual, no desde el target).
 * - `useReduceMotion` desactiva la animación de escala y muestra el valor
 *   estático (apple-design skill §14).
 *
 * **`variant` (D2, craft spec §3 home item 2):** default `"standalone"`
 * keeps the original floating pill (own `surfaceRaised` background/border) —
 * unchanged for existing call sites (`app/subjects/[subjectId]/temario.tsx`,
 * `temas/[topicId].tsx`, both out of D2's scope). `"bare"` strips that outer
 * chip and renders only the dot+text row, so `components/StatsStrip.tsx`
 * (D2, home screen) can host both `StreakDisplay` and `XpBadge` as "piezas
 * internas" inside ONE shared discreet strip instead of nesting a pill
 * inside a pill.
 *
 * **D2 fix (arquitecto REVIEW, 2026-07-22): clipping del XP en `StatsStrip`
 * a 390px.** The `"none"` copy ("Todavía no hay racha — cada explicación
 * cuenta") is a full sentence with no wrap/shrink/truncation of its own —
 * inside `StatsStrip`'s narrow row it forced its full intrinsic width and
 * pushed `XpBadge` past the right edge (clipped, only a sliver of "0"
 * visible at 390px). Fix, scoped to the `"bare"` variant only (`"standalone"`
 * pills are untouched — they already had room via their parent's `flexWrap`):
 * the row and every state's `Text` node now carry `flexShrink: 1` +
 * `numberOfLines={1}` (ellipsis truncation, not wrap — wrapping to 2 lines
 * would grow the strip's height inconsistently with the rest of D2's
 * fixed-height rhythm). The reason clause ("— explicaciones consistentes")
 * is DROPPED entirely in `"bare"` mode — it's the least essential text and
 * the tightest-space variant; keeping it would just be one more shrinking
 * element competing with the streak sentence for the same scarce room.
 * `components/StatsStrip.tsx` complements this by giving the `StreakDisplay`
 * wrapper `flex: 1, minWidth: 0` (the `minWidth: 0` matters specifically on
 * react-native-web, where a flex item's browser-default `min-width: auto`
 * would otherwise refuse to shrink below its content width — the same
 * quirk this whole bug came from) and the `XpBadge` wrapper `flexShrink: 0`
 * so XP NEVER shrinks/clips, always fully visible pinned to the strip's
 * right edge.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";

import { useT } from "../i18n/react";
import type { StreakResult } from "../lib/api/types";
import { formatStreakCount, streakReason, streakState } from "../lib/streak";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { radius, spacing, typography } from "../theme/tokens";

interface StreakDisplayProps {
  streak: StreakResult | null;
  /** @default "standalone" */
  variant?: "standalone" | "bare";
}

export function StreakDisplay({ streak, variant = "standalone" }: StreakDisplayProps) {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  const state = streakState(streak);
  const count = formatStreakCount(streak?.current ?? 0);
  const reason = streakReason(streak?.reasonKeys ?? []);

  // Spring animation for the streak count — apple-design skill §3-4:
  // critically damped (damping 1.0), response 0.4, interruptible by design.
  // Uses useState + lazy initializer (same pattern as ThinkingDots.tsx) so the
  // Animated.Value is available during render without accessing a ref's .current.
  const [scaleAnim] = useState(() => new Animated.Value(1));
  const prevCountRef = useRef(count);

  useEffect(() => {
    if (reduceMotion) {
      scaleAnim.setValue(1);
      return;
    }
    if (prevCountRef.current !== count && count !== "") {
      // Count changed — spring scale bump, interruptible (spring starts from
      // current on-screen value, skill §3: "Always animate from the
      // presentation (current) value").
      scaleAnim.setValue(1.15);
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        // Critically damped — no overshoot (skill §4: "damping 1.0").
        damping: 20,
        stiffness: 200,
        restSpeedThreshold: 0.5,
        restDisplacementThreshold: 0.5,
      }).start();
    }
    prevCountRef.current = count;
  }, [count, reduceMotion, scaleAnim]);

  // Color per state — muted for none/broken, accent for active.
  const stateColor = state === "active" ? colors.accent : colors.muted;

  if (state === "none" && !streak) {
    // Still loading — don't render anything yet.
    return null;
  }

  return (
    <View
      accessible
      accessibilityLabel={
        state === "active" && count
          ? t.courses.streak.active(Number(count))
          : state === "broken"
            ? t.courses.streak.broken
            : t.courses.streak.none
      }
      style={
        variant === "standalone"
          ? {
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceRaised,
              borderWidth: 1,
              borderColor: colors.border,
            }
          : { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 }
      }
    >
      {/* Streak icon — a simple dot or flame-like indicator. Never shrinks — the dot is the smallest, most important cue. */}
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: stateColor,
          flexShrink: 0,
        }}
      />

      {/* Streak count with spring animation */}
      {state === "active" && count ? (
        <Animated.View style={{ transform: [{ scale: scaleAnim }], flexShrink: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              color: stateColor,
              fontSize: typography.small.fontSize,
              lineHeight: typography.small.lineHeight,
              fontWeight: typography.weights.semibold,
              fontVariant: [...typography.tabularNums],
              flexShrink: 1,
            }}
          >
            {t.courses.streak.active(Number(count))}
          </Text>
        </Animated.View>
      ) : state === "broken" ? (
        <Text
          numberOfLines={1}
          style={{
            color: colors.muted,
            fontSize: typography.small.fontSize,
            lineHeight: typography.small.lineHeight,
            flexShrink: 1,
          }}
        >
          {t.courses.streak.broken}
        </Text>
      ) : (
        <Text
          numberOfLines={1}
          style={{
            color: colors.muted,
            fontSize: typography.small.fontSize,
            lineHeight: typography.small.lineHeight,
            flexShrink: 1,
          }}
        >
          {t.courses.streak.none}
        </Text>
      )}

      {/* Reason text — subtle, only when active AND standalone. Dropped in
          "bare" (the strip) — least essential text, tightest space, and one
          fewer element competing to shrink against the streak sentence (see
          module doc's D2 clipping-fix note). */}
      {state === "active" && reason && variant === "standalone" ? (
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
          }}
        >
          {t.courses.streak.reason(reason)}
        </Text>
      ) : null}
    </View>
  );
}
