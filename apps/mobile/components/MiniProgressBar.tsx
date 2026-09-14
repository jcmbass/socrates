/**
 * MiniProgressBar — D2 (craft spec §3): the small "m/n topics" fill used by
 * `SubjectCard` (grid) and `ContinueCard` (hero). Deliberately NOT the
 * animated header progress bar D3 will build for `SkillTree` (spec §4.3,
 * "fill animado en mount... spring settle, transform scaleX") — this one is
 * a static width-percentage fill. Two reasons: (1) it's not the screen's
 * focal element (the hero/grid cards fade+rise in as a BLOCK via D2's
 * entrance stagger — the fill itself doesn't need its own animation to
 * read as alive), and (2) reusing D3's not-yet-built scaleX+spring pattern
 * here would be inventing that contract early, out of D2's scope. If D3
 * wants to promote this to an animated shared component later, that's a
 * follow-up, not done speculatively here.
 *
 * Pure presentation — no react-native-reanimated. `percent` is clamped to
 * [0,100] so a caller passing 0/0 (empty temario) never renders a NaN width.
 */
import { View } from "react-native";

import { useTheme } from "../theme/useTheme";
import { radius } from "../theme/tokens";

export interface MiniProgressBarProps {
  doneCount: number;
  total: number;
  /** Track height in dp — default 4 (grid card), pass 6 for the hero card's slightly more prominent bar. */
  height?: number;
}

export function MiniProgressBar({ doneCount, total, height = 4 }: MiniProgressBarProps) {
  const { colors } = useTheme();
  const rawPercent = total === 0 ? 0 : (doneCount / total) * 100;
  const percent = Math.max(0, Math.min(100, rawPercent));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height,
        borderRadius: radius.full,
        backgroundColor: colors.border,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${percent}%`,
          borderRadius: radius.full,
          backgroundColor: colors.accent,
        }}
      />
    </View>
  );
}
