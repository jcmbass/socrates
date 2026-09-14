/**
 * Session closure — XP earned, hits, CTAs (D-S02 step 5).
 */
import { Text, View } from "react-native";

import { OutlineButton } from "../OutlineButton";
import { PrimaryButton } from "../PrimaryButton";
import { useT } from "../../i18n/react";
import { useTheme } from "../../theme/useTheme";
import { radius, spacing, typography } from "../../theme/tokens";

export function ClosureCard(props: {
  sessionXp: number;
  correctCount: number;
  itemTotal: number;
  onContinueChat: () => void;
  onNextTopic: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: "center" }}>
      <View
        style={{
          padding: spacing.xl,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceRaised,
          gap: spacing.md,
          alignItems: "center",
        }}
      >
        <Text style={{ color: colors.foreground, fontSize: typography.title.fontSize, fontWeight: typography.weights.bold }}>
          {t.guided.closureTitle}
        </Text>
        <Text
          style={{
            color: colors.accent,
            fontSize: typography.heading.fontSize,
            fontWeight: typography.weights.bold,
            fontVariant: [...typography.tabularNums],
          }}
        >
          {t.guided.closureXp(props.sessionXp)}
        </Text>
        {props.itemTotal > 0 ? (
          <Text style={{ color: colors.muted, fontSize: typography.body.fontSize }}>
            {t.guided.closureHits(props.correctCount, props.itemTotal)}
          </Text>
        ) : null}
        <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, textAlign: "center" }}>
          {t.guided.closureSessionBonus}
        </Text>
      </View>

      <PrimaryButton label={t.guided.continueChat} onPress={props.onContinueChat} />
      <OutlineButton label={t.guided.nextTopic} onPress={props.onNextTopic} />
    </View>
  );
}
