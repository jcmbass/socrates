/**
 * Guided session orchestrator (D-S01..S07). Default mode when opening a topic.
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClosureCard } from "./ClosureCard";
import { ExplainStep } from "./ExplainStep";
import { ExposureCards } from "./ExposureCards";
import { GuidedItemScreen } from "./GuidedItemScreen";
import { SessionDots } from "./SessionDots";
import { XpLevelBar } from "./XpLevelBar";
import { OnboardBackButton } from "../OnboardBackButton";
import { TutorMessage } from "../TutorMessage";
import { useT } from "../../i18n/react";
import { getStrings } from "../../i18n";
import { apiClient } from "../../lib/api/expoClient";
import { isUnauthorized } from "../../lib/api/errors";
import type {
  ActiveSessionSummary,
  FullStudySession,
  SessionOpening,
  XpSummary,
} from "../../lib/api/types";
import { appStore } from "../../lib/appStore";
import {
  buildDegradedSteps,
  buildRecipeSteps,
  isDegradedSession,
  resolveRecipeVariant,
  shouldShowGeneralContent,
  type RecipeFlatStep,
} from "../../lib/guidedRecipe";
import { readLastGuidedVariant, writeLastGuidedVariant } from "../../lib/guidedVariantStorage";
import { deriveXpDisplay } from "../../lib/homeCards";
import { shouldRequestTutorOpening } from "../../lib/transcriptEvents";
import { router } from "expo-router";
import { useTheme } from "../../theme/useTheme";
import { spacing, typography } from "../../theme/tokens";

/** First index at or after `from` that is not an item step already answered correctly. */
function nextUnansweredStep(steps: readonly RecipeFlatStep[], answered: ReadonlySet<string>, from: number): number {
  let i = from;
  while (i < steps.length - 1) {
    const step = steps[i];
    if (step?.kind !== "item" || !answered.has(step.item.id)) break;
    i++;
  }
  return i;
}

/**
 * Fresh topic → step 0. Returning to a topic with answered items → the first
 * unanswered item step, or the closure step when every item is answered.
 */
function resumeStepIndex(steps: readonly RecipeFlatStep[], answered: ReadonlySet<string>): number {
  if (!steps.some((s) => s.kind === "item" && answered.has(s.item.id))) return 0;
  const firstOpenItem = steps.findIndex((s) => s.kind === "item" && !answered.has(s.item.id));
  if (firstOpenItem >= 0) return firstOpenItem;
  const closure = steps.findIndex((s) => s.kind === "closure");
  return closure >= 0 ? closure : 0;
}

export function GuidedSession(props: {
  userId: string;
  token: string;
  subjectId: string;
  topicId: string;
  subjectTitle: string;
  topicTitle: string;
  onBack: () => void;
  onSwitchToFree: () => void;
  onNextTopic: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [steps, setSteps] = useState<RecipeFlatStep[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [degradedReason, setDegradedReason] = useState<"generation_failed" | "sources_required" | null>(null);
  const [grounding, setGrounding] = useState<"sources" | "general" | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [opening, setOpening] = useState<SessionOpening | null>(null);
  const [xp, setXp] = useState<XpSummary | null>(null);
  const [sessionXp, setSessionXp] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [itemTotal, setItemTotal] = useState(0);
  const [closureReady, setClosureReady] = useState(false);
  const [answeredItemIds, setAnsweredItemIds] = useState<ReadonlySet<string>>(new Set());

  const xpDisplay = deriveXpDisplay(xp);
  const totalXp = (xpDisplay.visible ? xpDisplay.total : 0) + sessionXp;

  useEffect(() => {
    let cancelled = false;
    const openingAbort = new AbortController();

    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const [itemsResult, lastVariant, activeSessions, xpResult] = await Promise.all([
          apiClient.ensureItems(props.token, props.subjectId, props.topicId),
          readLastGuidedVariant(props.topicId),
          apiClient.listActiveSessions(props.token),
          apiClient.getXp(props.token, props.subjectId).catch(() => null),
        ]);

        const variant = resolveRecipeVariant(props.userId, props.topicId, lastVariant);
        await writeLastGuidedVariant(props.topicId, variant);

        const degradedRun = isDegradedSession(itemsResult.items, itemsResult.degraded);
        const fallbackExposure = getStrings().guided.degradedExposure;
        const recipeSteps = degradedRun
          ? buildDegradedSteps(fallbackExposure)
          : buildRecipeSteps({
              items: itemsResult.items,
              variant,
              fallbackExposure,
            });

        const existing = (activeSessions as ActiveSessionSummary[])
          .filter((s) => s.subjectId === props.subjectId && s.topicId === props.topicId && s.kind === "topic")
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];

        const full: FullStudySession = existing
          ? await apiClient.getSession(props.token, existing.id)
          : { ...(await apiClient.createSession(props.token, { subjectId: props.subjectId, topicId: props.topicId })), exchanges: [] };

        if (cancelled) return;

        const answered = new Set(degradedRun ? [] : (itemsResult.answeredItemIds ?? []));
        const itemsInRecipe = recipeSteps.filter((s) => s.kind === "item").length;
        const alreadyCorrect = recipeSteps.filter((s) => s.kind === "item" && answered.has(s.item.id)).length;
        setSteps(recipeSteps);
        setAnsweredItemIds(answered);
        setDegraded(degradedRun);
        setDegradedReason(itemsResult.degradedReason);
        setGrounding(itemsResult.grounding);
        setItemTotal(itemsInRecipe);
        setSessionId(full.id);
        setOpening(full.opening ?? null);
        setXp(xpResult);
        setStepIndex(resumeStepIndex(recipeSteps, answered));
        setSessionXp(0);
        setCorrectCount(alreadyCorrect);
        setClosureReady(false);

        // Same session context as exposure cards (buildTopicSessionContext on
        // the server). Failure must not block the guided recipe.
        if (
          shouldRequestTutorOpening({
            kind: full.kind,
            topicId: full.topicId,
            exchangeCount: full.exchanges.length,
            hasOpening: Boolean(full.opening?.text),
          })
        ) {
          void apiClient
            .requestOpening(props.token, full.id, { signal: openingAbort.signal })
            .then((generated) => {
              if (!cancelled) setOpening(generated);
            })
            .catch(() => {
              /* guided continues without an opening */
            });
        }
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          await appStore.getState().logout();
          router.replace("/login");
          return;
        }
        setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      openingAbort.abort();
    };
  }, [props.token, props.subjectId, props.topicId, props.userId]);

  const currentStep = steps[stepIndex];
  const exposeTexts = steps.find((step) => step.kind === "expose")?.texts ?? [];

  function advance() {
    if (stepIndex >= steps.length - 1) return;
    setStepIndex((i) => nextUnansweredStep(steps, answeredItemIds, i + 1));
  }

  async function finishClosure() {
    if (closureReady) return;
    try {
      const result = await apiClient.completeGuided(props.token, props.subjectId, props.topicId);
      setSessionXp((xp) => xp + result.xpDelta);
      setClosureReady(true);
    } catch {
      setClosureReady(true);
    }
  }

  useEffect(() => {
    if (currentStep?.kind === "closure") void finishClosure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.kind]);

  const phaseLabel = useMemo(() => {
    if (!currentStep || currentStep.kind !== "item") return "";
    return currentStep.phase === "check" ? t.guided.checkLabel : t.guided.challengeLabel;
  }, [currentStep, t.guided.checkLabel, t.guided.challengeLabel]);

  function handleItemAnswered(result: { correct: boolean; xpDelta: number }) {
    if (result.correct) setCorrectCount((c) => c + 1);
    if (result.xpDelta > 0) setSessionXp((xp) => xp + result.xpDelta);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: insets.top + spacing.sm,
          paddingBottom: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: spacing.sm,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <OnboardBackButton onPress={props.onBack} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
              {props.subjectTitle}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: typography.title.fontSize, fontWeight: typography.weights.bold }}>
              {props.topicTitle}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t.guided.freeChatA11y} onPress={props.onSwitchToFree}>
            <Text style={{ color: colors.accent, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
              {t.guided.freeChatLink}
            </Text>
          </Pressable>
        </View>
        <XpLevelBar totalXp={totalXp} visible={xpDisplay.visible || sessionXp > 0} />
        {!loading && shouldShowGeneralContent(grounding, degradedReason) ? (
          <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize }}>
            {t.guided.generalContent}
          </Text>
        ) : null}
        {!loading && steps.length > 0 ? <SessionDots total={steps.length} current={stepIndex} /> : null}
      </View>

      <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md }}>
            <ActivityIndicator color={colors.accent} />
            <Text style={{ color: colors.muted, fontSize: typography.body.fontSize }}>{t.guided.loading}</Text>
          </View>
        ) : loadError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg }}>
            <Text style={{ color: colors.danger, fontSize: typography.body.fontSize, textAlign: "center" }}>{t.guided.loadError}</Text>
          </View>
        ) : currentStep?.kind === "expose" ? (
          <View style={{ flex: 1, minHeight: 0 }}>
            {opening?.text ? (
              <ScrollView
                style={{ flexGrow: 0, flexShrink: 1, maxHeight: 320 }}
                contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }}
                keyboardShouldPersistTaps="handled"
              >
                <TutorMessage text={opening.text} animate />
              </ScrollView>
            ) : null}
            <View style={{ flex: 1, minHeight: 0 }}>
              <ExposureCards texts={[...currentStep.texts]} degraded={degraded} onComplete={advance} />
            </View>
          </View>
        ) : currentStep?.kind === "item" ? (
          <GuidedItemScreen
            key={`${stepIndex}:${currentStep.item.id}`}
            item={currentStep.item}
            phaseLabel={phaseLabel}
            token={props.token}
            subjectId={props.subjectId}
            topicId={props.topicId}
            onAnswered={handleItemAnswered}
            onComplete={advance}
          />
        ) : currentStep?.kind === "explain" && sessionId ? (
          <ExplainStep
            token={props.token}
            sessionId={sessionId}
            topicTitle={props.topicTitle}
            ideas={exposeTexts}
            safeAreaBottom={insets.bottom}
            onComplete={advance}
          />
        ) : currentStep?.kind === "closure" ? (
          <ClosureCard
            sessionXp={sessionXp}
            correctCount={correctCount}
            itemTotal={itemTotal}
            onContinueChat={props.onSwitchToFree}
            onNextTopic={props.onNextTopic}
          />
        ) : null}
      </View>
    </View>
  );
}
