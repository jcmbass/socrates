/**
 * ContinueCard — D2 hero card (craft spec §3 home item 1): "Continuá donde
 * ibas". Renders the ONE subject `lib/homeCards.ts`'s `selectHeroCard`
 * picked — the caller (`app/courses/index.tsx`) simply doesn't render this
 * component at all when that returns `null` (no placeholder, per spec).
 *
 * Visual weight: this is the "one thing that glows" per screen (spec §1
 * dirección) — accent border, eyebrow in accent, taller/bolder than a grid
 * `SubjectCard`. Still `PressableScale` for press feedback (D1), same
 * `elevated` pressed-tint convention D1 established for interactive
 * secondary surfaces.
 */
import { Text, View } from "react-native";

import { MiniProgressBar } from "./MiniProgressBar";
import { PressableScale } from "./PressableScale";
import { useT } from "../i18n/react";
import { useTheme } from "../theme/useTheme";
import { radius, spacing, typography } from "../theme/tokens";

export interface ContinueCardProps {
  subjectName: string;
  /** Recommended (or next-up) topic title — null only if every topic is done, in which case no topic line renders. */
  topicTitle: string | null;
  doneCount: number;
  topicCount: number;
  starsTotal: number;
  onPress: () => void;
}

export function ContinueCard({ subjectName, topicTitle, doneCount, topicCount, starsTotal, onPress }: ContinueCardProps) {
  const t = useT();
  const { colors } = useTheme();
  const starsMax = topicCount * 3;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={
        topicTitle
          ? `${t.home.hero.eyebrow}: ${subjectName}, ${topicTitle}`
          : `${t.home.hero.eyebrow}: ${subjectName}`
      }
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.elevated : colors.surfaceRaised,
        borderWidth: 1,
        borderColor: colors.accent,
        borderRadius: radius.lg,
        padding: spacing.lg,
        gap: spacing.sm,
      })}
    >
      <Text
        style={{
          color: colors.accent,
          fontSize: typography.eyebrow.fontSize,
          lineHeight: typography.eyebrow.lineHeight,
          letterSpacing: typography.eyebrow.letterSpacing,
          fontWeight: typography.weights.semibold,
          textTransform: "uppercase",
        }}
      >
        {t.home.hero.eyebrow}
      </Text>

      <Text
        style={{
          color: colors.foreground,
          fontSize: typography.title.fontSize,
          lineHeight: typography.title.lineHeight,
          letterSpacing: typography.title.letterSpacing,
          fontWeight: typography.weights.semibold,
        }}
      >
        {subjectName}
      </Text>

      {topicTitle ? (
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
          }}
        >
          {topicTitle}
        </Text>
      ) : null}

      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <MiniProgressBar doneCount={doneCount} total={topicCount} height={6} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.caption.fontSize,
              fontVariant: [...typography.tabularNums],
            }}
          >
            {t.home.hero.progressLabel(doneCount, topicCount)}
          </Text>
          {starsTotal > 0 ? (
            <Text
              accessibilityLabel={t.home.hero.starsLabel(starsTotal, starsMax)}
              style={{
                color: colors.warning,
                fontSize: typography.caption.fontSize,
                fontVariant: [...typography.tabularNums],
              }}
            >
              {`★ ${starsTotal}/${starsMax}`}
            </Text>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}
