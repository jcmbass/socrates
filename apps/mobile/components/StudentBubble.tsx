/**
 * One student message: right-aligned bubble, max 85% width (A4 §4.1 — same
 * proportions as the harness's `max-w-[85%]` student bubble).
 *
 * Craft spec §5.2 (D4): `animate` (default false) plays the shared
 * new-message entrance (fade + rise 8dp, `useMessageEntranceStyle` —
 * see that module's doc for the new-vs-historical mechanism owned by the
 * calling screen). Omitting it keeps historical bubbles rendering exactly
 * as before (already placed, no animation).
 */
import { Text } from "react-native";
import Animated from "react-native-reanimated";

import { useReduceMotion, useTheme } from "../theme/useTheme";
import { radius, spacing, typography } from "../theme/tokens";
import { useMessageEntranceStyle } from "./useMessageEntrance";

export function StudentBubble(props: { text: string; animate?: boolean }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const entranceStyle = useMessageEntranceStyle(props.animate ?? false, reduceMotion);
  return (
    <Animated.View
      style={[
        {
          alignSelf: "flex-end",
          maxWidth: "85%",
          backgroundColor: colors.accentLight,
          borderRadius: radius.lg,
          borderBottomRightRadius: radius.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          marginVertical: spacing.xs,
        },
        entranceStyle,
      ]}
    >
      <Text
        style={{
          color: colors.foreground,
          fontSize: typography.body.fontSize,
          lineHeight: typography.body.lineHeight,
          fontFamily: typography.fontFamily.regular,
        }}
      >
        {props.text}
      </Text>
    </Animated.View>
  );
}
