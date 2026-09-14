/**
 * Labeled single-line text input. Body-size type (≥17, D2 §4.2), 48dp
 * floor, optional inline error in `danger`. `allowFontScaling` stays at
 * its default (true) everywhere — D2 §4.6.
 *
 * Craft spec §2.5 (D1): focus feedback — border crossfades to `accent` and
 * a subtle `accentLight` halo ring appears around the input, 150ms,
 * reanimated (`interpolateColor`/`withTiming` on a single `focusProgress`
 * shared value). NO shadows (moto e13 budget): the halo is a second
 * `Animated.View` one ring-thickness larger, sitting BEHIND the actual
 * bordered input, so it reads as a solid tinted ring peeking out at the
 * edges rather than a box-shadow. Blur crossfades back to `border` /
 * transparent the same way. An explicit `error` still wins over focus —
 * same precedence the original border-color ternary had.
 */
import { useCallback } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useTheme } from "../theme/useTheme";
import { crossfadeTiming } from "../theme/motion";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";

const RING_THICKNESS = 2;

export function TextField(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  error?: string | null;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  keyboardType?: TextInputProps["keyboardType"];
  maxLength?: number;
}) {
  const { colors } = useTheme();
  const focusProgress = useSharedValue(0);

  const handleFocus = useCallback(() => {
    focusProgress.value = withTiming(1, crossfadeTiming);
  }, [focusProgress]);
  const handleBlur = useCallback(() => {
    focusProgress.value = withTiming(0, crossfadeTiming);
  }, [focusProgress]);

  const { error } = props;
  const ringStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(focusProgress.value, [0, 1], ["transparent", colors.accentLight]),
  }));
  const borderStyle = useAnimatedStyle(() => ({
    borderColor: error ? colors.danger : interpolateColor(focusProgress.value, [0, 1], [colors.border, colors.accent]),
  }));

  return (
    <View style={{ gap: spacing.xs }}>
      <Text
        style={{
          color: colors.foreground,
          fontSize: typography.small.fontSize,
          lineHeight: typography.small.lineHeight,
          letterSpacing: typography.small.letterSpacing,
          fontWeight: typography.weights.medium,
        }}
      >
        {props.label}
      </Text>
      <Animated.View style={[{ borderRadius: radius.sm + RING_THICKNESS, padding: RING_THICKNESS }, ringStyle]}>
        <Animated.View
          style={[
            {
              borderWidth: 1,
              borderRadius: radius.sm,
              backgroundColor: colors.surfaceRaised,
              overflow: "hidden",
            },
            borderStyle,
          ]}
        >
          <TextInput
            value={props.value}
            onChangeText={props.onChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            underlineColorAndroid="transparent"
            placeholder={props.placeholder}
            placeholderTextColor={colors.muted}
            autoCapitalize={props.autoCapitalize}
            keyboardType={props.keyboardType}
            maxLength={props.maxLength}
            accessibilityLabel={props.label}
            style={{
              minHeight: MIN_TOUCH_TARGET,
              color: colors.foreground,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              fontSize: typography.body.fontSize,
              letterSpacing: typography.body.letterSpacing,
            }}
          />
        </Animated.View>
      </Animated.View>
      {props.error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: colors.danger,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
            letterSpacing: typography.caption.letterSpacing,
          }}
        >
          {props.error}
        </Text>
      ) : null}
    </View>
  );
}
