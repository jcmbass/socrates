/**
 * Session progress dots (D-S07) — one dot per recipe step, current highlighted.
 */
import { View } from "react-native";

import { useTheme } from "../../theme/useTheme";
import { spacing } from "../../theme/tokens";

export function SessionDots(props: { total: number; current: number }) {
  const { colors } = useTheme();
  if (props.total <= 1) return null;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: props.total - 1, now: props.current }}
      style={{ flexDirection: "row", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.xs }}
    >
      {Array.from({ length: props.total }, (_, i) => (
        <View
          key={i}
          style={{
            width: i === props.current ? 8 : 6,
            height: i === props.current ? 8 : 6,
            borderRadius: 4,
            backgroundColor: i === props.current ? colors.accent : colors.border,
          }}
        />
      ))}
    </View>
  );
}
