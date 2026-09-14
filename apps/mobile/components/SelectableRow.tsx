/**
 * Tappable selection row (checkbox or radio semantics via `role`). 48dp
 * floor; check/radio mark drawn with tokens, no icon dependency.
 *
 * Craft spec §2.5 (D1): press feedback via `PressableScale`; pressed tint
 * is now `elevated` (the depth-ladder token) instead of `accentLight` —
 * selection semantics untouched (W2 already validated them).
 */
import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { PressableScale } from "./PressableScale";

export function SelectableRow(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: "checkbox" | "radio";
  /** Smaller secondary line under the label. */
  caption?: string;
}) {
  const { colors } = useTheme();
  const role = props.role ?? "checkbox";
  const isRadio = role === "radio";
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityState={isRadio ? { selected: props.selected } : { checked: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.sm,
        backgroundColor: pressed ? colors.elevated : "transparent",
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: isRadio ? 12 : 6,
          borderWidth: 2,
          borderColor: props.selected ? colors.accent : colors.border,
          backgroundColor: props.selected ? colors.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.selected ? (
          isRadio ? (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.accentContrast,
              }}
            />
          ) : (
            <Text
              allowFontScaling={false}
              style={{
                color: colors.accentContrast,
                fontSize: 14,
                fontWeight: typography.weights.bold,
              }}
            >
              ✓
            </Text>
          )
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.foreground,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
            letterSpacing: typography.body.letterSpacing,
          }}
        >
          {props.label}
        </Text>
        {props.caption ? (
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.caption.fontSize,
              lineHeight: typography.caption.lineHeight,
              letterSpacing: typography.caption.letterSpacing,
            }}
          >
            {props.caption}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}
