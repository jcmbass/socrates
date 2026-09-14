/**
 * Exposure cards — one idea per card, PrimaryButton Continuar (D-S02 step 1).
 */
import { useState } from "react";
import { Text, View } from "react-native";

import { PrimaryButton } from "../PrimaryButton";
import { useT } from "../../i18n/react";
import { useTheme } from "../../theme/useTheme";
import { radius, spacing, typography } from "../../theme/tokens";

export function ExposureCards(props: {
  texts: string[];
  degraded?: boolean;
  onComplete: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [index, setIndex] = useState(0);
  const isLast = index >= props.texts.length - 1;

  function handleContinue() {
    if (isLast) props.onComplete();
    else setIndex((i) => i + 1);
  }

  return (
    <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: "space-between" }}>
      <View style={{ gap: spacing.md }}>
        <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
          {t.guided.exposureTitle}
        </Text>
        {props.degraded ? (
          <Text style={{ color: colors.warning, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
            {t.guided.degradedNote}
          </Text>
        ) : null}
        <View
          style={{
            padding: spacing.lg,
            borderRadius: radius.lg,
            backgroundColor: colors.surfaceRaised,
            gap: spacing.md,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight }}>
            {props.texts[index]}
          </Text>
          {props.texts.length > 1 ? (
            <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize }}>
              {index + 1} / {props.texts.length}
            </Text>
          ) : null}
        </View>
      </View>
      <PrimaryButton label={t.guided.continue} onPress={handleContinue} />
    </View>
  );
}
