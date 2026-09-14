/**
 * SubjectCard — D2 (craft spec §3 home item 3): the 2-col grid card, now
 * carrying real progress (fraction + micro-bar, `tabularNums`) and
 * accumulated stars instead of just a name + status line. Replaces the
 * inline `Pressable` `renderItem` `app/courses/index.tsx` had before —
 * same tap target/navigation, now with `PressableScale` (D1 craft: press
 * response on pointer-down) instead of a hand-rolled `pressed`-dependent
 * background swap... which is actually kept AS the `style` function form,
 * just handed to `PressableScale` instead of `Pressable` directly (that
 * component accepts the exact same `({pressed}) => style` shape, see its
 * own doc) — so the existing tint-on-press logic didn't need rewriting.
 *
 * Fixed `minHeight` (not just `flex:1` for width) so every card in a grid
 * row reads the same height regardless of whether it's "empty" (2 lines)
 * or "configured" (name + status + progress row) — spec item 3's "altura
 * consistente entre tarjetas".
 */
import { Text, View } from "react-native";

import { MiniProgressBar } from "./MiniProgressBar";
import { PressableScale } from "./PressableScale";
import { useT } from "../i18n/react";
import type { SubjectCardStatus } from "../lib/homeCards";
import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";

export interface SubjectCardProps {
  name: string;
  status: SubjectCardStatus;
  currentTopicTitle: string | null;
  doneCount: number;
  topicCount: number;
  starsTotal: number;
  /**
   * C2-e — the temario's seed book is in English (`TemarioWithVisibility`
   * 's `seedMaterialLang`, derived in `lib/homeCards.ts`'s
   * `buildSubjectCard`). Renders a DISCREET muted caption below the name —
   * no warning icon, no danger color: the material is simply in another
   * language, and the temario itself is still in the student's language.
   * Optional for backwards compatibility (absent = no note).
   */
  materialInEnglish?: boolean;
  onPress: () => void;
}

/** Reserves room for the tallest state (configured, with a progress row) so every card in the grid matches height. */
const CARD_MIN_HEIGHT = spacing.xxl * 4;

export function SubjectCard({ name, status, currentTopicTitle, doneCount, topicCount, starsTotal, materialInEnglish, onPress }: SubjectCardProps) {
  const t = useT();
  const { colors } = useTheme();
  const configured = status === "configured";

  return (
    <PressableScale
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: Math.max(MIN_TOUCH_TARGET + spacing.xl, CARD_MIN_HEIGHT),
        backgroundColor: pressed ? colors.accentLight : colors.surfaceRaised,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        padding: spacing.lg,
        justifyContent: "space-between",
      })}
    >
      <View style={{ gap: spacing.xs }}>
        <Text
          style={{
            color: colors.foreground,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
            letterSpacing: typography.body.letterSpacing,
            fontWeight: typography.weights.semibold,
          }}
        >
          {name}
        </Text>
        {materialInEnglish ? (
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.caption.fontSize,
              lineHeight: typography.caption.lineHeight,
              letterSpacing: typography.caption.letterSpacing,
            }}
          >
            {t.subject.materialInEnglish}
          </Text>
        ) : null}
        <Text
          style={{
            color: configured ? colors.accent : colors.muted,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
            letterSpacing: typography.caption.letterSpacing,
          }}
        >
          {configured ? t.home.status.configured(topicCount, currentTopicTitle) : t.home.status.empty}
        </Text>
      </View>

      {configured ? (
        <View style={{ gap: spacing.xs, marginTop: spacing.md }}>
          <MiniProgressBar doneCount={doneCount} total={topicCount} />
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
                style={{
                  color: colors.warning,
                  fontSize: typography.caption.fontSize,
                  fontVariant: [...typography.tabularNums],
                }}
              >
                {`★ ${starsTotal}`}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </PressableScale>
  );
}
