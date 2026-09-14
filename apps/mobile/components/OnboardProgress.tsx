/**
 * P3 onboarding step indicator — "Paso N de 3" + a row of dots, reused by
 * the three onboard/*.tsx screens. Static (no motion): DESIGN.md §6 already
 * discourages decorative animation on everyday chrome, and a step counter
 * is read once per screen, not something that benefits from movement.
 */
import { Text, View } from "react-native";

import { useT } from "../i18n/react";
import { useTheme } from "../theme/useTheme";
import { spacing, typography } from "../theme/tokens";

const TOTAL_STEPS = 3;

export function OnboardProgress(props: { step: 1 | 2 | 3 }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((step) => (
          <View
            key={step}
            style={{
              width: step === props.step ? 20 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: step <= props.step ? colors.accent : colors.border,
            }}
          />
        ))}
      </View>
      <Text
        style={{
          color: colors.muted,
          fontSize: typography.caption.fontSize,
          lineHeight: typography.caption.lineHeight,
          fontWeight: typography.weights.semibold,
        }}
      >
        {t.onboard.stepLabel(props.step)}
      </Text>
    </View>
  );
}
