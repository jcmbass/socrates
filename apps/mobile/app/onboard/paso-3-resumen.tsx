/**
 * P3/C2-c paso 3 — resumen. Used to be a per-subject temario configurator
 * ("Subir PDF" / "Manual" for each subject, one at a time) — that capability
 * moved out, it didn't disappear:
 *
 * - Seed subjects (paso-2's suggestions) arrive with their temario already
 *   built server-side (`activateSeedSubjects`, C2-a) — nothing to configure.
 * - A custom subject (DF-P09, "Crear mi propia materia" in paso-2) still
 *   gets an auto-created EMPTY temario (`POST /v1/subjects`), same as
 *   before.
 * - "Subir PDF" / "Manual" for an empty temario live on
 *   `app/subjects/[subjectId]/temario.tsx`'s own empty state
 *   (`skillTree.emptyState`) — that screen covers ANY subject, was never
 *   onboarding-only, and needed no change here.
 *
 * So this step no longer blocks on a per-subject pipeline: it shows an
 * honest resumen ("N materias · M temas listos", `lib/onboardSummary.ts`)
 * and seals the wizard (`completeOnboarding`, D-C07) before sending the
 * student to home — `/courses`, not a single subject's detail screen,
 * since the whole point of this pass is that onboarding can produce
 * several subjects at once.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { Redirect, router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OnboardBackButton } from "../../components/OnboardBackButton";
import { OnboardProgress } from "../../components/OnboardProgress";
import { PrimaryButton } from "../../components/PrimaryButton";
import { useT } from "../../i18n/react";
import { apiClient } from "../../lib/api/expoClient";
import { isUnauthorized } from "../../lib/api/errors";
import { appStore, useAppState } from "../../lib/appStore";
import { onboardDraft, useOnboardDraft } from "../../lib/onboardDraft";
import { buildOnboardSummary } from "../../lib/onboardSummary";
import { useTheme } from "../../theme/useTheme";
import { radius, spacing, typography } from "../../theme/tokens";

export default function OnboardPaso3Resumen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAppState((s) => s.auth);
  const courseId = useOnboardDraft((s) => s.courseId);
  const draftSubjects = useOnboardDraft((s) => s.subjects);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!auth) return <Redirect href="/login" />;
  if (!courseId || draftSubjects.length === 0) return <Redirect href="/onboard/paso-1-grados" />;
  const token = auth.token;

  const summary = buildOnboardSummary(draftSubjects);

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/onboard/paso-2-materias");
    }
  }

  async function handleFinish() {
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.completeOnboarding(token);
      onboardDraft.getState().reset();
      router.replace("/courses");
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setError(t.onboard.paso3.errors.completeFailed);
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={{ flex: 1, padding: spacing.lg, paddingTop: insets.top + spacing.lg, gap: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <OnboardBackButton onPress={handleBack} />
            <OnboardProgress step={3} />
          </View>

          <View style={{ gap: spacing.xs }}>
            <Text
              style={{
                color: colors.foreground,
                fontSize: typography.title.fontSize,
                lineHeight: typography.title.lineHeight,
                fontWeight: typography.weights.semibold,
              }}
            >
              {t.onboard.paso3.title}
            </Text>
            <Text style={{ color: colors.muted, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
              {t.onboard.paso3.subtitle}
            </Text>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceRaised,
              padding: spacing.lg,
              gap: spacing.xs,
            }}
          >
            <Text style={{ color: colors.accent, fontSize: typography.title.fontSize, fontWeight: typography.weights.semibold }}>
              {t.onboard.paso3.summary(summary.subjectCount, summary.topicCount)}
            </Text>
          </View>

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}
            >
              {error}
            </Text>
          ) : null}
        </View>

        <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, gap: spacing.sm }}>
          <PrimaryButton label={t.onboard.paso3.finish} onPress={() => void handleFinish()} disabled={submitting} />
          <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, textAlign: "center" }}>
            {t.onboard.paso3.finishCaption}
          </Text>
        </View>
      </View>
    </>
  );
}
