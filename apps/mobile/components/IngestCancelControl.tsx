/**
 * Cancel / "dejar de esperar" for material ingest (beta-real 09 P1+P2).
 *
 * Destructive control: touch target is sized to the label, NOT full-width
 * stretch — DESIGN.md §8. Accidental taps on the status line must not cancel.
 */
import { Pressable, Text, View } from "react-native";

import { useT } from "../i18n/react";
import { ingestCancelLabel } from "../lib/ingestStatusMessage";
import { isIngestAwaitingServer, type IngestState } from "../lib/materialIngestState";
import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";

export { ingestCancelLabel };

export function IngestCancelControl(props: { state: IngestState; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const awaitingServer = isIngestAwaitingServer(props.state);
  const label = ingestCancelLabel(props.state);

  return (
    <View style={{ gap: spacing.xs, marginTop: spacing.xs, alignSelf: "flex-start" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={props.onPress}
        style={{
          alignSelf: "flex-start",
          minHeight: MIN_TOUCH_TARGET,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.elevated,
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: colors.foreground,
            fontSize: typography.caption.fontSize,
            fontWeight: typography.weights.medium,
          }}
        >
          {label}
        </Text>
      </Pressable>
      {awaitingServer ? (
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
            maxWidth: 320,
          }}
        >
          {t.materialIngest.stopWaitingHint}
        </Text>
      ) : null}
    </View>
  );
}
