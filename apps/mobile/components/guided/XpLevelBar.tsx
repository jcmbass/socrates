/**
 * Thin XP level bar for guided session header (D-S06).
 * Level = floor(totalXp / 100) + 1; fill = progress within current level.
 */
import { Text, View } from "react-native";

import { useT } from "../../i18n/react";
import { xpLevelProgress } from "../../lib/guidedRecipe";
import { useTheme } from "../../theme/useTheme";
import { radius, spacing, typography } from "../../theme/tokens";

export function XpLevelBar(props: { totalXp: number; visible?: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  if (props.visible === false) return null;

  const { level, progress } = xpLevelProgress(props.totalXp);

  return (
    <View
      accessible
      accessibilityLabel={`${t.home.xp.label}, ${t.home.xp.label} ${level}`}
      style={{ gap: spacing.xs }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, fontWeight: typography.weights.medium }}>
          {t.home.xp.label}
        </Text>
        <Text
          style={{
            color: colors.accent,
            fontSize: typography.caption.fontSize,
            fontWeight: typography.weights.semibold,
            fontVariant: [...typography.tabularNums],
          }}
        >
          {level}
        </Text>
      </View>
      <View
        style={{
          height: 3,
          borderRadius: radius.full,
          backgroundColor: colors.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${Math.round(progress * 100)}%`,
            backgroundColor: colors.accent,
            borderRadius: radius.full,
          }}
        />
      </View>
    </View>
  );
}
