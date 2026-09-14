/**
 * "Tutor is thinking" indicator — covers submit → first streamed token
 * (A4: `awaitingFirstToken`). Paired with the `contemplating` TutorAvatar
 * variant (DESIGN.md §5: reserved for reflection/waiting states) plus
 * three staggered-opacity dots via RN Animated (no reanimated dependency
 * for this), and — DF-5.5, wired BY HAND as RN requires — when the OS
 * reduce-motion setting is on, renders STATIC dots with no animation at
 * all. Only the dots animate; the avatar itself never scales/rotates
 * (DESIGN.md §6 — the portrait doesn't get animated as a "loading" trick).
 */
import { useEffect, useState } from "react";
import { Animated, View } from "react-native";

import { useT } from "../i18n/react";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { spacing } from "../theme/tokens";
import { TutorAvatar } from "./TutorAvatar";

const DOT_COUNT = 3;
const CYCLE_MS = 1400;

export function ThinkingDots() {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  // Lazy state initializer (not a ref): the Animated.Values are read during
  // render, and react-hooks/refs forbids reading refs there.
  const [values] = useState(() =>
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.25)),
  );

  useEffect(() => {
    if (reduceMotion) {
      values.forEach((v) => v.setValue(0.6));
      return;
    }
    const loops = values.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((i * CYCLE_MS) / DOT_COUNT),
          Animated.timing(value, { toValue: 1, duration: CYCLE_MS / 2, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.25, duration: CYCLE_MS / 2, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [reduceMotion, values]);

  return (
    <View
      accessible
      accessibilityLabel={t.study.thinkingA11yLabel}
      style={{
        flexDirection: "row",
        gap: spacing.xs,
        paddingVertical: spacing.sm,
        alignItems: "center",
      }}
    >
      <TutorAvatar variant="contemplating" size={24} />
      {values.map((value, i) => (
        <Animated.View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.muted,
            opacity: value,
          }}
        />
      ))}
    </View>
  );
}
