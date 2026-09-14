/**
 * Soft pulsing orb for "work in progress" — visual cousin of
 * https://orbs.jakubantalik.com/ thinking-orbs, built for React Native
 * (no DOM/CSS package; do NOT install `thinking-orbs`).
 *
 * Pattern mirrors `GlowRing` in `SkillTree.tsx` (commit 4f71d59 lesson):
 * opacity-only reanimated worklets, cancel the loop when idle, respect
 * `useReduceMotion`. An orb in the always-visible header is the same
 * jank recipe as GlowRing-during-scroll if it keeps pulsing at rest —
 * so this component runs a loop ONLY while `active` is true (and reduce-
 * motion is off). When inactive it returns null: zero animation running.
 */
import { useEffect } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { orbPulse } from "../theme/motion";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { shouldRunOrbPulse } from "../lib/orbPulse";

const ORB_MIN_OPACITY = 0.35;
const ORB_MAX_OPACITY = 0.95;
const ORB_STATIC_OPACITY = 0.7;
const ORB_CORE_RATIO = 0.45;

function startOrbPulse(opacity: SharedValue<number>) {
  "worklet";
  opacity.value = ORB_MIN_OPACITY;
  opacity.value = withRepeat(
    withTiming(ORB_MAX_OPACITY, {
      duration: orbPulse.halfCycleDuration,
      easing: Easing.inOut(Easing.ease),
    }),
    -1,
    true,
  );
}

function stopOrbPulse(opacity: SharedValue<number>, freezeAt: number) {
  "worklet";
  cancelAnimation(opacity);
  opacity.value = freezeAt;
}

export function ThinkingOrb(props: {
  /** When false: render nothing — zero animation running at rest. */
  active: boolean;
  /** Discrete header size; default fits the Fuentes pill (not 64 web-demo). */
  size?: number;
}) {
  const size = props.size ?? 12;
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(ORB_STATIC_OPACITY);

  useEffect(() => {
    if (!shouldRunOrbPulse(props.active, reduceMotion)) {
      stopOrbPulse(opacity, ORB_STATIC_OPACITY);
      return;
    }
    startOrbPulse(opacity);
    return () => {
      stopOrbPulse(opacity, ORB_STATIC_OPACITY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active, reduceMotion]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!props.active) return null;

  const core = Math.max(4, Math.round(size * ORB_CORE_RATIO));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.accent,
        },
        glowStyle,
      ]}
    >
      <Animated.View
        style={{
          width: core,
          height: core,
          borderRadius: core / 2,
          backgroundColor: colors.accentContrast,
          opacity: 0.85,
        }}
      />
    </Animated.View>
  );
}
