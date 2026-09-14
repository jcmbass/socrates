/**
 * Collapsible syllabus-unit section.
 *
 * Keep closed trees unmounted: a subject can contain dozens of units and
 * every tree owns SVG and animation worklets. Open content deliberately uses
 * normal React Native flow instead of a measured-height animation. Android
 * does not reliably report the intrinsic height of an absolute child inside
 * a zero-height clipped parent; that made newly opened trees stay at height
 * zero on the Moto e13 even though the header said they were expanded.
 */
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { springs } from "../theme/motion";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { radius, spacing, typography } from "../theme/tokens";
import { PressableScale } from "./PressableScale";

export function CollapsibleUnitSection(props: {
  title: string;
  /** e.g. "3/8" — already formatted by the caller (`i18n`-localized digits/format live there, not here). */
  progressLabel: string;
  open: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const chevronProgress = useSharedValue(props.open ? 1 : 0);

  useEffect(() => {
    chevronProgress.value = reduceMotion
      ? props.open
        ? 1
        : 0
      : withSpring(props.open ? 1 : 0, springs.settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, reduceMotion]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 90}deg` }],
  }));

  return (
    <View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        accessibilityState={{ expanded: props.open }}
        onPress={props.onToggle}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surfaceRaised,
        }}
      >
        <Animated.Text style={[{ color: colors.muted, fontSize: typography.body.fontSize, fontWeight: typography.weights.bold }, chevronStyle]}>
          ›
        </Animated.Text>
        <Text
          numberOfLines={2}
          style={{
            flex: 1,
            color: colors.foreground,
            fontSize: typography.small.fontSize,
            lineHeight: typography.small.lineHeight,
            fontWeight: typography.weights.semibold,
          }}
        >
          {props.title}
        </Text>
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
            fontWeight: typography.weights.semibold,
            fontVariant: [...typography.tabularNums],
          }}
        >
          {props.progressLabel}
        </Text>
      </PressableScale>

      {props.open ? <View style={{ paddingTop: spacing.md }}>{props.children}</View> : null}
    </View>
  );
}
