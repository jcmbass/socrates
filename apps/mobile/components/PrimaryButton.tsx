/**
 * Primary action button. D2: min touch target 48dp, accent/accent-contrast
 * pair (contrast-safe in both themes by token construction). Screens place
 * it in the bottom third (thumb zone) — that placement is the screen's
 * layout job, not this component's.
 *
 * Craft spec §2.5 (D1): press feedback via `PressableScale` (scale 0.97 on
 * down, spring back on release, reduce-motion = opacity dim — see that
 * component's doc). Enabled<->disabled is now a 150ms crossfade of
 * background + label color (`disabledProgress`, a single reanimated shared
 * value driving both via `interpolateColor`), not a hard jump.
 *
 * Variant `glass` (F3 visual refinement): wraps the button in a native blur
 * layer (`expo-blur`) and uses a translucent accent fill so the background
 * shows through. The blur reads the pixels behind the button, which is the
 * closest available approximation to real refraction on this device budget.
 * Falls back gracefully to a plain translucent button if the platform blur
 * is unavailable or too expensive.
 */
import { useEffect } from "react";
import { BlurView } from "expo-blur";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useTheme } from "../theme/useTheme";
import { crossfadeTiming } from "../theme/motion";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { PressableScale } from "./PressableScale";

/** Añade canal alfa a un color hex #RRGGBB, devolviendo #RRGGBBAA. */
function withAlpha(hex: string, alpha256: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(alpha256)));
  const alpha = clamped.toString(16).padStart(2, "0");
  return `${hex}${alpha}`;
}

export function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** `glass` adds a native blur backdrop; `solid` keeps the original opaque fill. */
  variant?: "solid" | "glass";
  /** Reduce horizontal padding for a slightly narrower pill. */
  compact?: boolean;
}) {
  const { colors, scheme } = useTheme();
  const disabled = props.disabled ?? false;
  const variant = props.variant ?? "solid";
  const isGlass = variant === "glass";
  const disabledProgress = useSharedValue(disabled ? 1 : 0);

  useEffect(() => {
    disabledProgress.value = withTiming(disabled ? 1 : 0, crossfadeTiming);
  }, [disabled, disabledProgress]);

  /**
   * Los dos extremos del interpolado se calculan ACÁ, en el hilo de JS, no
   * dentro del worklet. Dos razones, y la primera es un crash duro:
   *
   * 1. `useAnimatedStyle` corre en el hilo de UI. Llamar desde ahí a
   *    `withAlpha` —una función de módulo normal, no workletizada por el
   *    plugin de Babel de Reanimated— revienta la app al montar con
   *    `[Worklets] Tried to synchronously call a Remote Function`. Solo se
   *    manifestaba en `glass`, que es el unico branch que la usaba.
   * 2. Aunque no crasheara, no tiene sentido: no dependen de
   *    `disabledProgress`, así que reconstruir esos strings hex en cada
   *    frame es trabajo puro de descarte.
   *
   * El worklet ahora solo captura dos strings ya listos.
   */
  const [fromColor, toColor] = isGlass
    ? [withAlpha(colors.accent, 185), withAlpha(colors.border, 140)]
    : [colors.accent, colors.border];

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(disabledProgress.value, [0, 1], [fromColor, toColor]),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(disabledProgress.value, [0, 1], [colors.accentContrast, colors.muted]),
  }));

  const buttonBody = (
    <PressableScale
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={[
        {
          minHeight: MIN_TOUCH_TARGET,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: props.compact ? spacing.md : spacing.lg,
          paddingVertical: spacing.sm,
        },
        containerStyle,
      ]}
    >
      <Animated.Text
        style={[
          {
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
            letterSpacing: typography.body.letterSpacing,
            fontWeight: typography.weights.semibold,
            fontFamily: typography.fontFamily.semibold,
          },
          labelStyle,
        ]}
      >
        {props.label}
      </Animated.Text>
    </PressableScale>
  );

  if (!isGlass) return buttonBody;

  return (
    <BlurView
      intensity={40}
      tint={scheme === "dark" ? "dark" : "light"}
      style={{ borderRadius: radius.md, overflow: "hidden" }}
    >
      {buttonBody}
    </BlurView>
  );
}
