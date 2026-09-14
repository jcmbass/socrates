/**
 * P3/C2-c paso 2 — materias. Options now come from the **seed catalog**
 * (`getSeedSubjects(level)`, C2-a) instead of `subjectTemplatesForGradeLevel`
 * — that fixed a real bug: universidad had no `SubjectTemplate` rows (R-2),
 * so this screen used to render empty for every university student. The
 * seed level is derived from the draft's `gradeLevelId`
 * (`seedLevelForGradeLevelId`, lib/onboardCatalog.ts).
 *
 * D-C07: a tester who already has a course/subjects (enrolled before C2-c)
 * can land here too — `needsOnboarding` now gates on `onboardingCompletedAt`,
 * not "has an active course". Their own subjects are fetched and shown
 * pre-checked alongside the seed suggestions (already-active seed keys are
 * excluded from the suggestions, `activeSeedKeys`) — unchecking one never
 * deletes it (no delete path here); it only leaves it out of THIS session's
 * resumen count. "Crear mi propia materia" (DF-P09) is a secondary action
 * at the end of the list, not the primary flow.
 *
 * Continuing calls `activateSeedSubjects` for the checked seed keys (their
 * temario arrives already built) and the existing `createOnboardSubjects`
 * (POST /v1/subjects) for custom names, then hands paso-3 a topic-count-
 * aware subject list for its resumen (`lib/onboardSummary.ts`).
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Redirect, router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OnboardBackButton } from "../../components/OnboardBackButton";
import { OnboardProgress } from "../../components/OnboardProgress";
import { OutlineButton } from "../../components/OutlineButton";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SelectableRow } from "../../components/SelectableRow";
import { TextField } from "../../components/TextField";
import { useLocale, useT } from "../../i18n/react";
import { apiClient } from "../../lib/api/expoClient";
import { isUnauthorized } from "../../lib/api/errors";
import type { SeedSubjectOption } from "../../lib/api/types";
import { appStore, useAppState } from "../../lib/appStore";
import { gradeLevelIdLabel } from "../../lib/catalogLabels";
import {
  addCustomSubject,
  initialSubjectSelections,
  seedLevelForGradeLevelId,
  selectedCount,
  selectedCustomNames,
  selectedSeedKeys,
  toggleSelection,
  type SubjectSelection,
} from "../../lib/onboardCatalog";
import { onboardDraft, useOnboardDraft } from "../../lib/onboardDraft";
import { activateOnboardSeedSubjects, createOnboardSubjects } from "../../lib/onboardFlow";
import { useTheme } from "../../theme/useTheme";
import { spacing, typography } from "../../theme/tokens";

type LoadState = "loading" | "error" | "ready";

export default function OnboardPaso2Materias() {
  const t = useT();
  const { colors } = useTheme();
  const { locale } = useLocale();
  const insets = useSafeAreaInsets();
  const auth = useAppState((s) => s.auth);
  const gradeLevelId = useOnboardDraft((s) => s.gradeLevelId);
  const courseId = useOnboardDraft((s) => s.courseId);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selections, setSelections] = useState<SubjectSelection[]>([]);
  const [seedCatalog, setSeedCatalog] = useState<SeedSubjectOption[]>([]);
  const [existingTopicCounts, setExistingTopicCounts] = useState<Record<string, number>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = auth?.token;
    if (!token || !gradeLevelId || !courseId) return;
    let cancelled = false;
    (async () => {
      setLoadState("loading");
      try {
        const level = seedLevelForGradeLevelId(gradeLevelId);
        const [seedSubjects, subjects] = await Promise.all([
          level ? apiClient.getSeedSubjects(level) : Promise.resolve<SeedSubjectOption[]>([]),
          apiClient.listSubjects(token, courseId),
        ]);
        if (cancelled) return;
        const activeSubjects = subjects.filter((subject) => subject.archivedAt === null);
        const topicCounts = await Promise.all(
          activeSubjects.map((subject) => apiClient.getTemario(token, subject.id).catch(() => null)),
        );
        if (cancelled) return;
        const counts: Record<string, number> = {};
        activeSubjects.forEach((subject, i) => {
          counts[subject.id] = topicCounts[i]?.topics.length ?? 0;
        });
        setExistingTopicCounts(counts);
        setSeedCatalog(seedSubjects);
        setSelections(
          initialSubjectSelections(
            activeSubjects.map((subject) => ({ id: subject.id, name: subject.name, seedCatalogKey: subject.seedCatalogKey })),
            seedSubjects,
            locale,
          ),
        );
        setLoadState("ready");
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          await appStore.getState().logout();
          router.replace("/login");
          return;
        }
        setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth?.token, gradeLevelId, courseId, locale, reloadKey]);

  if (!auth) return <Redirect href="/login" />;
  if (!gradeLevelId || !courseId) return <Redirect href="/onboard/paso-1-grados" />;
  const token = auth.token;
  const boundCourseId = courseId;

  const gradeLabel = gradeLevelIdLabel(gradeLevelId, t);

  /** Prefer popping the stack (keeps paso-1's local selection state alive,
   * same native-stack screen instance) — falls back to `replace` only for
   * a direct deep-link into this screen with no paso-1 in the nav stack. */
  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/onboard/paso-1-grados");
    }
  }

  function handleAddCustom() {
    if (customName.trim().length === 0) return;
    setSelections((current) => addCustomSubject(current, customName));
    setCustomName("");
    setError(null);
  }

  async function handleContinue() {
    if (selectedCount(selections) === 0) {
      setError(t.onboard.paso2.errors.noneSelected);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const seedKeys = selectedSeedKeys(selections);
      const customNames = selectedCustomNames(selections);
      const [activated, custom] = await Promise.all([
        activateOnboardSeedSubjects(apiClient, token, boundCourseId, seedKeys),
        createOnboardSubjects(apiClient, token, boundCourseId, customNames),
      ]);

      const seedTopicCount = (seedCatalogKey: string | null): number => {
        if (!seedCatalogKey) return 0;
        const option = seedCatalog.find((s) => s.subjectKey === seedCatalogKey);
        return option?.topicCount[locale] ?? 0;
      };

      const existingDrafts = selections
        .filter((selection) => selection.source === "existing" && selection.selected)
        .map((selection) => ({ id: selection.id, name: selection.name, topicCount: existingTopicCounts[selection.id] ?? 0 }));
      const activatedDrafts = activated.map((subject) => ({
        id: subject.id,
        name: subject.name,
        topicCount: seedTopicCount(subject.seedCatalogKey),
      }));
      const customDrafts = custom.map((subject) => ({ id: subject.id, name: subject.name, topicCount: 0 }));

      onboardDraft.getState().setSubjects([...existingDrafts, ...activatedDrafts, ...customDrafts]);
      router.push("/onboard/paso-3-resumen");
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setError(t.onboard.paso2.errors.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const existingSelections = selections.filter((s) => s.source === "existing");
  const seedSelections = selections.filter((s) => s.source === "seed");
  const customSelections = selections.filter((s) => s.source === "custom");

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg, gap: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <OnboardBackButton onPress={handleBack} />
            <OnboardProgress step={2} />
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
              {t.onboard.paso2.title}
            </Text>
            <Text style={{ color: colors.muted, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
              {t.onboard.paso2.gradeCaption(gradeLabel)}
            </Text>
          </View>

          {loadState === "loading" ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: "center", gap: spacing.sm }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize }}>{t.common.loading}</Text>
            </View>
          ) : loadState === "error" ? (
            <View style={{ gap: spacing.sm, alignItems: "flex-start" }}>
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}
              >
                {t.common.genericError}
              </Text>
              <OutlineButton label={t.common.retry} onPress={() => setReloadKey((k) => k + 1)} />
            </View>
          ) : (
            <>
              <View
                style={{
                  alignSelf: "flex-start",
                  backgroundColor: colors.accentLight,
                  borderRadius: spacing.sm,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                }}
              >
                <Text style={{ color: colors.accent, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
                  {t.onboard.paso2.counter(selectedCount(selections))}
                </Text>
              </View>

              {existingSelections.length > 0 ? (
                <View style={{ gap: spacing.xs }}>
                  <Text style={{ color: colors.foreground, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>
                    {t.onboard.paso2.existingLabel}
                  </Text>
                  {existingSelections.map((selection) => (
                    <SelectableRow
                      key={selection.id}
                      label={selection.name}
                      selected={selection.selected}
                      onPress={() => setSelections((current) => toggleSelection(current, selection.id))}
                    />
                  ))}
                </View>
              ) : null}

              <View style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.foreground, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>
                  {t.onboard.paso2.suggestedLabel}
                </Text>
                {seedSelections.length > 0 ? (
                  <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                    {t.onboard.paso2.suggestedHint}
                  </Text>
                ) : (
                  <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                    {t.onboard.paso2.noSuggestionsNotice}
                  </Text>
                )}
              </View>

              <View>
                {seedSelections.map((selection) => (
                  <SelectableRow
                    key={selection.id}
                    label={selection.name}
                    selected={selection.selected}
                    onPress={() => setSelections((current) => toggleSelection(current, selection.id))}
                  />
                ))}
              </View>

              {customSelections.length > 0 ? (
                <View>
                  {customSelections.map((selection) => (
                    <SelectableRow
                      key={selection.id}
                      label={selection.name}
                      selected={selection.selected}
                      onPress={() => setSelections((current) => toggleSelection(current, selection.id))}
                    />
                  ))}
                </View>
              ) : null}

              {/* DF-P09: still available, demoted to a secondary action at the end of the list. */}
              {showCustomForm ? (
                <View style={{ gap: spacing.sm }}>
                  <TextField
                    label={t.onboard.paso2.addCustomLabel}
                    value={customName}
                    onChangeText={setCustomName}
                    placeholder={t.onboard.paso2.addCustomPlaceholder}
                    maxLength={60}
                  />
                  <OutlineButton label={t.onboard.paso2.addCustomButton} onPress={handleAddCustom} disabled={customName.trim().length === 0} />
                </View>
              ) : (
                <OutlineButton label={t.onboard.paso2.addCustomToggle} onPress={() => setShowCustomForm(true)} />
              )}
            </>
          )}

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, gap: spacing.sm }}>
          <PrimaryButton
            label={t.onboard.paso2.continue}
            onPress={() => void handleContinue()}
            disabled={submitting || loadState !== "ready" || selectedCount(selections) === 0}
          />
          <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, textAlign: "center" }}>
            {t.onboard.paso2.footnote}
          </Text>
        </View>
      </View>
    </>
  );
}
