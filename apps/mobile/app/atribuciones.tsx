/**
 * Atribuciones (C2-b) — pushed from Perfil. Lists the 10 seed books behind
 * the app's suggested syllabi, sourced LIVE from
 * `apiClient.getSeedAttributions()` (C2-a, `GET /v1/seed/attributions`) —
 * never hand-typed per-book copy, so the list can't drift from the actual
 * catalog.
 *
 * DESIGN.md §7: loading/error states stay neutral — "no pudimos cargar",
 * a retry button, no alarmist red banner for what's just a slow/failed
 * fetch of static reference data.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "../components/PrimaryButton";
import { PressableScale } from "../components/PressableScale";
import { useT } from "../i18n/react";
import { apiClient } from "../lib/api/expoClient";
import type { SeedAttribution } from "../lib/api/types";
import { radius, spacing, typography } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";

export default function Atribuciones() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<SeedAttribution[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // El `setError(false)` del reintento va DENTRO del async, no en el cuerpo
    // del efecto: llamar a setState sincrónicamente dentro de un efecto
    // dispara renders en cascada (regla `react-hooks/set-state-in-effect`, la
    // misma que ya tiene al resto del proyecto en deuda — no se agrega más).
    (async () => {
      try {
        setError(false);
        const list = await apiClient.getSeedAttributions();
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <>
      <Stack.Screen options={{ title: t.attributions.title }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surface }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}
      >
        <Text style={{ color: colors.muted, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight }}>
          {t.attributions.intro}
        </Text>

        {items === null && !error ? (
          <View style={{ paddingVertical: spacing.xl, alignItems: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <View style={{ gap: spacing.md, alignItems: "flex-start" }}>
            <Text style={{ color: colors.muted, fontSize: typography.body.fontSize }}>{t.attributions.loadError}</Text>
            <PrimaryButton label={t.common.retry} onPress={retry} compact />
          </View>
        ) : (
          (items ?? []).map((item, index) => (
            <View
              key={`${item.title}-${index}`}
              style={{
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
                padding: spacing.md,
                gap: spacing.xs,
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: typography.body.fontSize, fontWeight: typography.weights.semibold }}>
                {item.title}
              </Text>
              <Text style={{ color: colors.muted, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
                {item.publisher}
              </Text>
              <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                {t.attributions.licenseLabel(item.licenseName)}
              </Text>
              <PressableScale
                accessibilityRole="link"
                accessibilityLabel={t.attributions.openSource}
                onPress={() => {
                  void Linking.openURL(item.sourceUrl).catch(() => {
                    // Best-effort: no toast/alert plumbing on this screen yet —
                    // the link itself stays visible for the student to retry.
                  });
                }}
                style={{ alignSelf: "flex-start", paddingVertical: spacing.xs }}
              >
                <Text style={{ color: colors.accent, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>
                  {t.attributions.openSource}
                </Text>
              </PressableScale>
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}
