/**
 * XpBadge — P4 home header. Shows the student's total XP as a plain,
 * honest counter (NOT a progress-to-goal bar): the XP curve/goal is an
 * explicitly OPEN founder question (plan-producto-maqueta 00-vision-
 * decisiones.md §7 Q1 — "curva de XP exacta"). The maqueta's `assets/
 * home.html` fakes a "320 / 500 XP" bar against a hardcoded goal that
 * doesn't exist in this codebase; inventing one here would be the same
 * kind of dishonest progress-over-nothing P3's DEVLOG already called out
 * for the onboarding upload flow. Once the founder picks a curve, this
 * component is the one place a goal-relative fill would be added.
 *
 * Degrades to nothing (`null`) when `visible` is false — antifuga: the
 * server omits the numeric field entirely in shadow mode
 * (`lib/homeCards.ts`'s `deriveXpDisplay`), and this component must never
 * render a fabricated 0 in that case, matching the plan's "degradación
 * limpia, no crash" requirement.
 *
 * Reuses the same critically-damped spring bump `StreakDisplay.tsx`
 * already established for a changing count (apple-design skill §3-4).
 *
 * **`variant` (D2, craft spec §3 home item 2):** default `"standalone"`
 * keeps the original floating `accentLight` pill — unchanged for existing
 * call sites (`temario.tsx`, `temas/[topicId].tsx`, out of D2's scope).
 * `"bare"` strips the pill so `components/StatsStrip.tsx` can host it
 * inside one shared strip alongside `StreakDisplay` (see that component's
 * matching `variant` doc).
 */
import { useEffect, useState } from "react";
import { Animated, Text, View } from "react-native";

import { useT } from "../i18n/react";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { radius, spacing, typography } from "../theme/tokens";

export function XpBadge(props: { visible: boolean; total: number; variant?: "standalone" | "bare" }) {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [scaleAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      scaleAnim.setValue(1);
      return;
    }
    scaleAnim.setValue(1.12);
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
      restSpeedThreshold: 0.5,
      restDisplacementThreshold: 0.5,
    }).start();
    // Re-bump only when the total actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.total, reduceMotion]);

  if (!props.visible) return null;
  const variant = props.variant ?? "standalone";

  return (
    <View
      accessible
      accessibilityLabel={`${t.home.xp.label}: ${props.total}`}
      style={
        variant === "standalone"
          ? {
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              backgroundColor: colors.accentLight,
              alignSelf: "flex-start",
            }
          : { flexDirection: "row", alignItems: "center", gap: spacing.xs }
      }
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Text
          style={{
            color: colors.accent,
            fontSize: typography.small.fontSize,
            lineHeight: typography.small.lineHeight,
            fontWeight: typography.weights.semibold,
            fontVariant: [...typography.tabularNums],
          }}
        >
          {props.total}
        </Text>
      </Animated.View>
      <Text style={{ color: colors.accent, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight, fontWeight: typography.weights.medium }}>
        {t.home.xp.label}
      </Text>
    </View>
  );
}
