/**
 * Language selector (A1) — three-option radio group: "Automático
 * (dispositivo)" / Español / English. Card variant (default) lives on
 * `app/perfil.tsx` (moved there C2-b, was home's foot before there was a
 * profile screen).
 *
 * `variant="compact"` (C2-c) — a single discrete row for paso-1-grados'
 * footer: the device/pista-A locale is already applied, this is just a
 * confirmation, not a first-time choice, so it doesn't earn the full card
 * treatment. Same options, same a11y labels, same `useLocale()` — a
 * horizontal segmented row instead of a vertical list of 48dp rows.
 *
 * DESIGN.md derivation: dark-first tokens (surfaceRaised card + border on
 * the `surface` page), 8-12px corners (radius.md/radius.full), selected
 * state carried by weight + accent fill, MIN_TOUCH_TARGET = 48 targets,
 * accessibilityRole="radio" + accessibilityState so screen readers announce
 * "seleccionado". apple-design §1: feedback on PRESS (backgroundColor flips
 * the frame the finger lands, not on release); no scale/entrance animation —
 * a settings control that animates is noise (§16 Purpose).
 */
import { Pressable, Text, View } from "react-native";

import { useLocale, useT } from "../i18n/react";
import type { LocaleOverride } from "../i18n";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";

interface LanguageOption {
  value: LocaleOverride;
  labelKey: "languageAuto" | "languageEs" | "languageEn";
}

const OPTIONS: readonly LanguageOption[] = [
  { value: null, labelKey: "languageAuto" },
  { value: "es", labelKey: "languageEs" },
  { value: "en", labelKey: "languageEn" },
];

export function LanguageSelector(props: { variant?: "card" | "compact" }) {
  const { colors } = useTheme();
  const t = useT();
  const { override, setOverride } = useLocale();

  if (props.variant === "compact") {
    return (
      <View
        accessibilityLabel={t.settings.languageSectionA11y}
        style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm }}
      >
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
            fontWeight: typography.weights.semibold,
          }}
        >
          {t.settings.languageTitle}
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.xs }}>
          {OPTIONS.map((option) => {
            const selected = override === option.value;
            return (
              <Pressable
                key={option.labelKey}
                accessibilityRole="radio"
                accessibilityLabel={t.settings[option.labelKey]}
                accessibilityState={{ checked: selected }}
                onPress={() => setOverride(option.value)}
                style={({ pressed }) => ({
                  minHeight: MIN_TOUCH_TARGET,
                  justifyContent: "center",
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accent : pressed ? colors.elevated : "transparent",
                  paddingHorizontal: spacing.md,
                })}
              >
                <Text
                  style={{
                    color: selected ? colors.accentContrast : colors.muted,
                    fontSize: typography.caption.fontSize,
                    lineHeight: typography.caption.lineHeight,
                    fontWeight: selected ? typography.weights.semibold : typography.weights.regular,
                  }}
                >
                  {t.settings[option.labelKey]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={t.settings.languageSectionA11y}
      style={{
        marginTop: spacing.xl,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceRaised,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <Text
        style={{
          color: colors.muted,
          fontSize: typography.eyebrow.fontSize,
          lineHeight: typography.eyebrow.lineHeight,
          letterSpacing: typography.eyebrow.letterSpacing,
          textTransform: "uppercase",
          fontWeight: typography.weights.semibold,
          fontFamily: typography.fontFamily.semibold,
        }}
      >
        {t.settings.languageTitle}
      </Text>
      {OPTIONS.map((option) => {
        const selected = override === option.value;
        return (
          <Pressable
            key={option.labelKey}
            accessibilityRole="radio"
            accessibilityLabel={t.settings[option.labelKey]}
            accessibilityState={{ checked: selected }}
            onPress={() => setOverride(option.value)}
            style={({ pressed }) => ({
              minHeight: MIN_TOUCH_TARGET,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              borderRadius: radius.sm,
              paddingHorizontal: spacing.sm,
              // apple-design §1 — highlight on press-down, instant.
              backgroundColor: pressed && !selected ? colors.elevated : "transparent",
            })}
          >
            <Text
              style={{
                color: selected ? colors.foreground : colors.muted,
                fontSize: typography.body.fontSize,
                lineHeight: typography.body.lineHeight,
                fontWeight: selected ? typography.weights.semibold : typography.weights.regular,
                fontFamily: selected ? typography.fontFamily.semibold : typography.fontFamily.regular,
              }}
            >
              {t.settings[option.labelKey]}
            </Text>
            {selected ? (
              <Text
                accessible={false}
                style={{ color: colors.accent, fontSize: typography.body.fontSize }}
              >
                ✓
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}