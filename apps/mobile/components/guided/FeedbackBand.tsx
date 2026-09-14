/**
 * Post-answer feedback band (D-S05): success token or soft amber fail,
 * rotating micro-copy, explanation, optional retry.
 */
import { Text, View } from "react-native";

import { PrimaryButton } from "../PrimaryButton";
import { PressableScale } from "../PressableScale";
import { useT } from "../../i18n/react";
import { useTheme } from "../../theme/useTheme";
import { radius, spacing, typography } from "../../theme/tokens";

export function FeedbackBand(props: {
  correct: boolean;
  microcopy: string;
  explanation: string;
  xpDelta: number;
  canRetry: boolean;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();

  return (
    <View
      style={{
        marginTop: spacing.md,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: props.correct ? colors.successBg : colors.warningBg,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text
          style={{
            color: props.correct ? colors.success : colors.warning,
            fontSize: typography.body.fontSize,
            fontWeight: typography.weights.semibold,
            flex: 1,
          }}
        >
          {props.microcopy}
        </Text>
        {props.xpDelta > 0 ? (
          <Text
            style={{
              color: props.correct ? colors.success : colors.warning,
              fontSize: typography.caption.fontSize,
              fontWeight: typography.weights.semibold,
              fontVariant: [...typography.tabularNums],
            }}
          >
            {t.guided.xpEarned(props.xpDelta)}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: colors.foreground, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
        {props.explanation}
      </Text>
      <View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" }}>
        {props.canRetry ? (
          <PressableScale onPress={props.onRetry}>
            <Text style={{ color: colors.accent, fontSize: typography.body.fontSize, fontWeight: typography.weights.semibold, padding: spacing.sm }}>
              {t.guided.retryOnce}
            </Text>
          </PressableScale>
        ) : null}
        <PrimaryButton label={t.guided.continue} onPress={props.onContinue} compact />
      </View>
    </View>
  );
}
