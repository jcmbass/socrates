/**
 * Inline transcript divider for a `MaterialEvent` (F2 WQ3 parte C2 — closes
 * the WQ2 acceptance-6 gap, see `app/study/[subjectId].tsx`'s module doc
 * and `../lib/transcriptEvents.ts`). A centered, muted, caption-sized row —
 * DESIGN.md §6's "indicadores de progreso: línea fina... no spinners
 * genéricos ni barras gruesas" restraint applied to a static marker: no
 * icon, no card, just small text, same register as
 * `MaterialIngestBar.tsx`'s "done" banner but permanent (survives
 * scroll/reload) instead of dismissible/ephemeral.
 */
import { Text, View } from "react-native";

import { useT } from "../i18n/react";
import { useTheme } from "../theme/useTheme";
import { spacing, typography } from "../theme/tokens";
import type { MaterialEvent } from "../lib/api/types";

export function MaterialEventMarker(props: { event: MaterialEvent }) {
  const { colors } = useTheme();
  // A1 — labelFor lived at module scope reading the static `t`; folded into
  // the component so the marker copy follows the active locale (useT).
  const t = useT();
  const template = props.event.action === "added" ? t.study.materialAddedMarker : t.study.materialRemovedMarker;
  const label = template.replace("{source}", props.event.source);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{ alignItems: "center", marginVertical: spacing.sm }}
    >
      <Text
        style={{
          color: colors.muted,
          fontSize: typography.caption.fontSize,
          lineHeight: typography.caption.lineHeight,
          fontFamily: typography.fontFamily.regular,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
