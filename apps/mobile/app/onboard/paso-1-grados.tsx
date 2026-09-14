/**
 * P3 paso 1 — grados. Maps `assets/onboard-paso-1-grados.html`'s flow
 * (mundo/etapa picker → grado) onto the REAL El Salvador catalog
 * (`lib/catalog.ts`, already shipped for `courses/new.tsx`) instead of the
 * maqueta's hardcoded 11-grade demo list — this app only ever seeds
 * bachillerato/universidad as selectable (Básica shown-but-disabled, DF-P01).
 *
 * Skin is DESIGN.md tokens throughout — none of the maqueta's
 * `#0f1b3d`/`#3b9eff` blues. Bachillerato's "año" isn't a separate modal
 * like the maqueta's demo (its 9-grade primaria list needed one for a
 * single "bachi" node) — the real catalog already models each bachillerato
 * año as its own enabled GradeLevel, so the existing stage → GradeLevel
 * radio list (same shape `courses/new.tsx` already ships) covers it with
 * no extra step.
 *
 * "Continuar" creates the Course right away (`findOrCreateOnboardCourse`,
 * lib/onboardFlow.ts — P4 fix for the "Course huérfano" dedup debt, reuses
 * an existing active course for this grade level instead of duplicating it
 * on re-entry) — paso-2 needs a real `courseId` to attach Subjects to, same
 * as `courses/new.tsx`'s single-screen flow, just split at this seam per
 * the maqueta's 3-step structure.
 */
import { useEffect, useMemo, useState } from "react";
import { Animated, ScrollView, Text, View } from "react-native";
import { Redirect, router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip } from "../../components/Chip";
import { LanguageSelector } from "../../components/LanguageSelector";
import { OnboardProgress } from "../../components/OnboardProgress";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SelectableRow } from "../../components/SelectableRow";
import { useT } from "../../i18n/react";
import { apiClient } from "../../lib/api/expoClient";
import { isUnauthorized } from "../../lib/api/errors";
import { appStore, useAppState } from "../../lib/appStore";
import { enabledGradeLevelsForStage, stageOptions } from "../../lib/catalog";
import { gradeLevelLabel, stageLabel } from "../../lib/catalogLabels";
import { findOrCreateOnboardCourse } from "../../lib/onboardFlow";
import { onboardDraft } from "../../lib/onboardDraft";
import { useReduceMotion, useTheme } from "../../theme/useTheme";
import { spacing, typography } from "../../theme/tokens";

const COMING_SOON_MS = 3000;

export default function OnboardPaso1Grados() {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const auth = useAppState((s) => s.auth);
  const stages = useMemo(() => stageOptions(), []);

  const [stageId, setStageId] = useState<string | null>(null);
  const [gradeLevelId, setGradeLevelId] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Lazy state initializer (not a ref): the Animated.Value is read during
  // render (the Animated.View's `opacity` style below), and
  // react-hooks/refs forbids reading refs there — same fix ThinkingDots.tsx
  // already applies.
  const [noticeOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!comingSoon) return;
    if (reduceMotion) {
      noticeOpacity.setValue(1);
    } else {
      noticeOpacity.setValue(0);
      Animated.timing(noticeOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
    const timer = setTimeout(() => setComingSoon(null), COMING_SOON_MS);
    return () => clearTimeout(timer);
  }, [comingSoon, reduceMotion, noticeOpacity]);

  if (!auth) return <Redirect href="/login" />;
  const token = auth.token;

  const gradeLevels = stageId ? enabledGradeLevelsForStage(stageId) : [];

  function selectStage(id: string) {
    setStageId(id);
    setGradeLevelId(null);
    setError(null);
  }

  async function handleContinue() {
    if (!gradeLevelId) {
      setError(t.onboard.paso1.errors.gradeRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // P4 fix: reuse an already-created active course for this grade level
      // instead of creating an orphaned duplicate on re-entry (DEVLOG P3 debt).
      const course = await findOrCreateOnboardCourse(apiClient, token, gradeLevelId);
      onboardDraft.getState().setGrade({ gradeLevelId, courseId: course.id });
      router.push("/onboard/paso-2-materias");
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setError(t.onboard.paso1.errors.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* W2: native header hidden — this screen's own header (progress dots +
          title + subtitle below) is the single source of the screen title,
          per the onboarding header convention established this pass (see
          paso-2/paso-3 for the same pattern, plus their in-page back
          button — paso 1 is the start of the flow and never has one). */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg, gap: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <OnboardProgress step={1} />

          <View style={{ gap: spacing.xs }}>
            <Text
              style={{
                color: colors.foreground,
                fontSize: typography.title.fontSize,
                lineHeight: typography.title.lineHeight,
                fontWeight: typography.weights.semibold,
              }}
            >
              {t.onboard.paso1.title}
            </Text>
            <Text
              style={{
                color: colors.muted,
                fontSize: typography.small.fontSize,
                lineHeight: typography.small.lineHeight,
              }}
            >
              {t.onboard.paso1.subtitle}
            </Text>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {stages.map(({ stage, enabled }) => (
              <Chip
                key={stage.id}
                label={stageLabel(stage, t)}
                selected={stageId === stage.id}
                disabled={!enabled}
                disabledCaption={t.onboard.paso1.stageComingSoon}
                onPress={() => selectStage(stage.id)}
                onDisabledPress={() => setComingSoon(t.onboard.paso1.stageComingSoonNotice(stageLabel(stage, t)))}
              />
            ))}
          </View>

          {comingSoon ? (
            <Animated.View
              accessibilityLiveRegion="polite"
              style={{
                opacity: noticeOpacity,
                backgroundColor: colors.warningBg,
                borderRadius: spacing.sm,
                borderWidth: 1,
                borderColor: colors.warning,
                padding: spacing.md,
              }}
            >
              <Text style={{ color: colors.warning, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                {comingSoon}
              </Text>
            </Animated.View>
          ) : null}

          {stageId ? (
            <View style={{ gap: spacing.sm }}>
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: typography.small.fontSize,
                  lineHeight: typography.small.lineHeight,
                  fontWeight: typography.weights.semibold,
                }}
              >
                {t.onboard.paso1.gradeLabel}
              </Text>
              {gradeLevels.map((level) => (
                <SelectableRow
                  key={level.id}
                  role="radio"
                  label={gradeLevelLabel(level, t)}
                  selected={gradeLevelId === level.id}
                  onPress={() => {
                    setGradeLevelId(level.id);
                    setError(null);
                  }}
                />
              ))}
            </View>
          ) : null}

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, gap: spacing.md }}>
          <PrimaryButton label={t.onboard.paso1.continue} onPress={() => void handleContinue()} disabled={submitting || !gradeLevelId} />
          {/* C2-c: idioma ya viene detectado (pista A) — esta fila solo lo
              confirma, por eso la variante compacta y no una card completa. */}
          <LanguageSelector variant="compact" />
          <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, textAlign: "center" }}>
            {t.onboard.paso1.footnote}
          </Text>
        </View>
      </View>
    </>
  );
}
