/**
 * Selection chip (stage picker, A1 §1.4). Disabled chips stay VISIBLE with
 * a caption ("próximamente") — shown-but-disabled, never hidden (A-spec
 * §8.3). 48dp floor.
 *
 * `onDisabledPress` (P3, onboard/paso-1-grados.tsx): when set, a disabled
 * chip stays TAPPABLE — it calls this instead of `onPress` — so a screen
 * can show a "próximamente" message on tap rather than a silent dead
 * button. Omitting it keeps the original behavior (RN's native
 * `Pressable.disabled`, no press fires at all) — existing callers
 * (`courses/new.tsx`) are unaffected.
 *
 * Craft spec §2.5 (D1): press feedback via `PressableScale`; pressed tint
 * on an UNSELECTED chip is now `elevated` (the depth-ladder token) instead
 * of `accentLight` — selection semantics untouched (W2 already validated
 * them): `selected` still always wins (accent fill) regardless of press.
 */
import { Text } from "react-native";

import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { PressableScale } from "./PressableScale";

export function Chip(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Shown under the label on disabled chips (e.g. "próximamente"). */
  disabledCaption?: string;
  /** Called instead of `onPress` when disabled AND provided — see module doc. */
  onDisabledPress?: () => void;
}) {
  const { colors } = useTheme();
  const disabled = props.disabled ?? false;
  const nativelyDisabled = disabled && !props.onDisabledPress;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: props.selected }}
      disabled={nativelyDisabled}
      onPress={disabled ? props.onDisabledPress : props.onPress}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: props.selected ? colors.accent : colors.border,
        backgroundColor: props.selected
          ? colors.accent
          : pressed
            ? colors.elevated
            : colors.surfaceRaised,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          color: disabled
            ? colors.muted
            : props.selected
              ? colors.accentContrast
              : colors.foreground,
          fontSize: typography.small.fontSize,
          lineHeight: typography.small.lineHeight,
          letterSpacing: typography.small.letterSpacing,
          fontWeight: typography.weights.medium,
        }}
      >
        {props.label}
      </Text>
      {disabled && props.disabledCaption ? (
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
            letterSpacing: typography.caption.letterSpacing,
          }}
        >
          {props.disabledCaption}
        </Text>
      ) : null}
    </PressableScale>
  );
}
