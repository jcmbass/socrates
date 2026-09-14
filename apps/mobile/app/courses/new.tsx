/**
 * A1 §1.4 / A2 §2.1 crear curso — catalog picker, not a free form:
 * - Stage chips: básica visible but DISABLED ("próximamente" — §8.3),
 *   bachillerato/universidad selectable (the catalog decides: a stage is
 *   selectable iff it has enabled GradeLevels).
 * - GradeLevel radio list from the @buxo/domain El Salvador catalog.
 * - Bachillerato: subject templates pre-checked (student unchecks — never
 *   an empty first course). Universidad: no template by design (R-2).
 *
 * F1/WP6 Part 2 DEVIATION (flagged for architect review): WP2's
 * `customLabel` free-text field is dropped here. apps/server's
 * `CreateCourseSchema` (routes/courses.ts, WP5) only accepts
 * `gradeLevelId`/`academicYear` — `Course.customLabel` exists in
 * `@buxo/domain` but WP5's POST /v1/courses never wired it through. Showing
 * the input while the server silently discards it would be a dishonest
 * affordance; extending that route is out of this wave's authorized
 * apps/server scope (only Part 1's fake-models mode touches apps/server).
 */
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Redirect, router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip } from "../../components/Chip";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SelectableRow } from "../../components/SelectableRow";
import { useT } from "../../i18n/react";
import { apiClient } from "../../lib/api/expoClient";
import { isUnauthorized } from "../../lib/api/errors";
import { appStore, useAppState } from "../../lib/appStore";
import {
  enabledGradeLevelsForStage,
  stageOptions,
  subjectTemplatesForGradeLevel,
} from "../../lib/catalog";
import { gradeLevelLabel, stageLabel, subjectTemplateLabel } from "../../lib/catalogLabels";
import { useTheme } from "../../theme/useTheme";
import { spacing, typography } from "../../theme/tokens";

export default function NewCourse() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAppState((s) => s.auth);
  const stages = useMemo(() => stageOptions(), []);

  const [stageId, setStageId] = useState<string | null>(null);
  const [gradeLevelId, setGradeLevelId] = useState<string | null>(null);
  /** Template ids UNchecked by the student (pre-checked by default, A1 §1.4). */
  const [uncheckedTemplateIds, setUncheckedTemplateIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!auth) return <Redirect href="/login" />;
  const token = auth.token;

  const gradeLevels = stageId ? enabledGradeLevelsForStage(stageId) : [];
  const templates = gradeLevelId ? subjectTemplatesForGradeLevel(gradeLevelId) : [];

  function selectStage(id: string) {
    setStageId(id);
    setGradeLevelId(null);
    setUncheckedTemplateIds(new Set());
  }

  function selectGradeLevel(id: string) {
    setGradeLevelId(id);
    setUncheckedTemplateIds(new Set());
    setError(null);
  }

  function toggleTemplate(id: string) {
    setUncheckedTemplateIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    if (!gradeLevelId) {
      setError(t.newCourse.errors.gradeRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const subjectNames = templates
        .filter((template) => !uncheckedTemplateIds.has(template.id))
        // A2 — created Subject names follow the active locale (resolved by
        // the template's stable nameKey), same label the student unchecked.
        .map((template) => subjectTemplateLabel(template, t));
      const course = await apiClient.createCourse(token, { gradeLevelId });
      // Bachillerato pre-checks templates (A1 §1.4) — created in order, sequentially (small counts, order matters for display).
      for (const name of subjectNames) {
        await apiClient.createSubject(token, { courseId: course.id, name });
      }
      router.replace({
        pathname: "/courses/[courseId]",
        params: { courseId: course.id },
      });
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setError(t.newCourse.errors.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t.newCourse.title }} />
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <SectionLabel text={t.newCourse.stageLabel} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {stages.map(({ stage, enabled }) => (
              <Chip
                key={stage.id}
                label={stageLabel(stage, t)}
                selected={stageId === stage.id}
                disabled={!enabled}
                disabledCaption={t.newCourse.stageComingSoon}
                onPress={() => selectStage(stage.id)}
              />
            ))}
          </View>

          {stageId ? (
            <>
              <SectionLabel text={t.newCourse.gradeLabel} />
              <View>
                {gradeLevels.map((level) => (
                  <SelectableRow
                    key={level.id}
                    role="radio"
                    label={gradeLevelLabel(level, t)}
                    selected={gradeLevelId === level.id}
                    onPress={() => selectGradeLevel(level.id)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {templates.length > 0 ? (
            <>
              <SectionLabel text={t.newCourse.templatesLabel} />
              <Text
                style={{
                  color: colors.muted,
                  fontSize: typography.caption.fontSize,
                  lineHeight: typography.caption.lineHeight,
                }}
              >
                {t.newCourse.templatesHint}
              </Text>
              <View>
                {templates.map((template) => (
                  <SelectableRow
                    key={template.id}
                    label={subjectTemplateLabel(template, t)}
                    selected={!uncheckedTemplateIds.has(template.id)}
                    onPress={() => toggleTemplate(template.id)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: colors.danger,
                fontSize: typography.caption.fontSize,
                lineHeight: typography.caption.lineHeight,
              }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg }}>
          <PrimaryButton
            label={t.newCourse.create}
            onPress={() => void handleCreate()}
            disabled={submitting || !gradeLevelId}
          />
        </View>
      </View>
    </>
  );
}

function SectionLabel(props: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        color: colors.foreground,
        fontSize: typography.small.fontSize,
        lineHeight: typography.small.lineHeight,
        fontWeight: typography.weights.semibold,
      }}
    >
      {props.text}
    </Text>
  );
}
