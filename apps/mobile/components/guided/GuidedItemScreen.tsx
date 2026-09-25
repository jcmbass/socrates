/**
 * One guided item — prompt + option rows (≥48dp), selected state, feedback.
 */
import { useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { FeedbackBand } from "./FeedbackBand";
import { PrimaryButton } from "../PrimaryButton";
import { PressableScale } from "../PressableScale";
import { useT } from "../../i18n/react";
import { apiClient } from "../../lib/api/expoClient";
import { isUnauthorized } from "../../lib/api/errors";
import type { GuidedItemPublic } from "../../lib/api/types";
import { nextMicrocopyIndex } from "../../lib/guidedRecipe";
import { appStore } from "../../lib/appStore";
import { router } from "expo-router";
import { useReduceMotion, useTheme } from "../../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../../theme/tokens";

export function GuidedItemScreen(props: {
  item: GuidedItemPublic;
  phaseLabel: string;
  token: string;
  subjectId: string;
  topicId: string;
  onAnswered: (result: { correct: boolean; xpDelta: number }) => void;
  onComplete: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const scrollRef = useRef<ScrollView>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    explanation: string;
    xpDelta: number;
    attempt: 1 | 2;
    microcopy: string;
  } | null>(null);
  const [attempt, setAttempt] = useState<1 | 2>(1);
  const lastSuccessIdx = useRef<number | null>(null);
  const lastFailIdx = useRef<number | null>(null);

  const startedAtRef = useRef(Date.now());

  function pickMicrocopy(correct: boolean): string {
    const list = correct ? t.guided.successMicrocopy : t.guided.softFailMicrocopy;
    const last = correct ? lastSuccessIdx.current : lastFailIdx.current;
    const idx = nextMicrocopyIndex(list.length, last);
    if (correct) lastSuccessIdx.current = idx;
    else lastFailIdx.current = idx;
    return list[idx] ?? list[0] ?? "";
  }

  async function submit(nextAttempt: 1 | 2) {
    if (selected === null || submitting) return;
    setSubmitting(true);
    const responseMs = Date.now() - startedAtRef.current;
    try {
      const result = await apiClient.answerItem(props.token, props.subjectId, props.topicId, props.item.id, {
        selected,
        attempt: nextAttempt,
        responseMs,
      });
      setFeedback({
        correct: result.correct,
        explanation: result.explanation,
        xpDelta: result.xpDelta,
        attempt: nextAttempt,
        microcopy: pickMicrocopy(result.correct),
      });
      props.onAnswered({ correct: result.correct, xpDelta: result.xpDelta });
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setFeedback({
        correct: false,
        explanation: t.common.genericError,
        xpDelta: 0,
        attempt: nextAttempt,
        microcopy: pickMicrocopy(false),
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetry() {
    setSelected(null);
    setFeedback(null);
    setAttempt(2);
    startedAtRef.current = Date.now();
  }

  // A long prompt + options + feedback can exceed the viewport; scrolling
  // keeps FeedbackBand's Continue reachable. `flexGrow: 1` preserves the
  // Confirm button's `marginTop: "auto"` bottom anchoring when content is short.
  return (
    <ScrollView
      ref={scrollRef}
      onContentSizeChange={() => {
        if (feedback !== null) scrollRef.current?.scrollToEnd({ animated: !reduceMotion });
      }}
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, gap: spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
        {props.phaseLabel}
      </Text>
      <View style={{ padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised }}>
        <Text style={{ color: colors.foreground, fontSize: typography.title.fontSize, fontWeight: typography.weights.bold, lineHeight: typography.title.lineHeight }}>
          {props.item.prompt}
        </Text>
      </View>

      <View style={{ gap: spacing.xs }}>
        {props.item.options.map((option) => {
          const isSelected = selected === option;
          return (
            <PressableScale
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              disabled={feedback !== null || submitting}
              onPress={() => setSelected(option)}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: isSelected ? colors.accent : colors.border,
                backgroundColor: isSelected ? colors.accentLight : colors.elevated,
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight }}>
                {option}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {feedback === null ? (
        <View style={{ marginTop: "auto", gap: spacing.sm }}>
          {submitting ? <ActivityIndicator color={colors.accent} /> : null}
          <PrimaryButton
            label={t.guided.confirm}
            disabled={selected === null || submitting}
            onPress={() => void submit(attempt)}
          />
        </View>
      ) : (
        <FeedbackBand
          correct={feedback.correct}
          microcopy={feedback.microcopy}
          explanation={feedback.explanation}
          xpDelta={feedback.xpDelta}
          canRetry={!feedback.correct && feedback.attempt === 1}
          onRetry={handleRetry}
          onContinue={props.onComplete}
        />
      )}
    </ScrollView>
  );
}
