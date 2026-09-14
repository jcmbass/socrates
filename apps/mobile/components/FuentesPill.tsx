/**
 * Header "Fuentes N" pill — shows a ThinkingOrb while ingest is busy so the
 * student can close the Sources modal and keep chatting. Indication comes
 * from `fuentesPillIndication` (same busy gate as `isIngestBusy`).
 */
import { Pressable, Text, View } from "react-native";

import { useT } from "../i18n/react";
import { fuentesPillIndication } from "../lib/fuentesPillIndication";
import type { IngestState } from "../lib/materialIngestState";
import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { ThinkingOrb } from "./ThinkingOrb";

export function FuentesPill(props: {
  count: number;
  ingest: IngestState;
  onPress: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const indication = fuentesPillIndication(props.ingest, props.count);
  const isError = indication.kind === "error";
  const isBusy = indication.kind === "busy";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={indication.a11yLabel}
      accessibilityState={{ busy: isBusy }}
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        gap: spacing.xs,
        minHeight: MIN_TOUCH_TARGET,
        paddingHorizontal: spacing.md,
        borderRadius: radius.full,
        backgroundColor: isError ? colors.dangerBg : colors.accentLight,
      }}
    >
      <Text
        style={{
          color: isError ? colors.danger : colors.accent,
          fontSize: typography.small.fontSize,
          fontWeight: typography.weights.semibold,
        }}
      >
        {indication.label}
      </Text>
      {isBusy ? (
        <ThinkingOrb active size={12} />
      ) : (
        <View
          style={{
            backgroundColor: isError ? colors.danger : colors.accent,
            borderRadius: radius.full,
            paddingHorizontal: spacing.xs,
            minWidth: 18,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: colors.accentContrast,
              fontSize: typography.caption.fontSize,
              fontWeight: typography.weights.bold,
            }}
          >
            {isError ? "!" : props.count}
          </Text>
        </View>
      )}
      {isBusy ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          numberOfLines={1}
          style={{
            color: colors.muted,
            fontSize: typography.caption.fontSize,
            // No maxWidth: 72 used to clip "Procesando…" to "Procesan…".
            // flexShrink:0 so the busy label keeps its intrinsic width; the
            // topic title (flex:1, numberOfLines=1) is the one that truncates.
            flexShrink: 0,
          }}
        >
          {t.fuentes.processing}
        </Text>
      ) : null}
    </Pressable>
  );
}
