/**
 * "Explicalo con tus palabras" — one student turn via postExchange (D-S02 step 3).
 */
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { ChatComposer } from "../ChatComposer";
import { PrimaryButton } from "../PrimaryButton";
import { StudentBubble } from "../StudentBubble";
import { ThinkingDots } from "../ThinkingDots";
import { TutorMessage } from "../TutorMessage";
import { useKeyboardBottomInsetStyle } from "../useKeyboardBottomInset";
import { useT } from "../../i18n/react";
import { apiClient } from "../../lib/api/expoClient";
import { ApiError, isQuotaExceeded, isUnauthorized } from "../../lib/api/errors";
import { turnErrorCopy } from "../../lib/turnErrorCopy";
import { findLandedTurn, shouldCheckIfTurnLanded } from "../../lib/turnReconcile";
import { resolveClientMessageId } from "../../lib/clientMessageId";
import { appStore } from "../../lib/appStore";
import { router } from "expo-router";
import { useTheme } from "../../theme/useTheme";
import { radius, spacing, typography } from "../../theme/tokens";

function clipIdea(text: string, max = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function ExplainStep(props: {
  token: string;
  sessionId: string;
  topicTitle: string;
  ideas: readonly string[];
  safeAreaBottom: number;
  onComplete: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [pendingStudent, setPendingStudent] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const sendingRef = useRef(false);
  const pendingClientMessageIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // GuidedSession already owns the static safe-area padding. Add only the
  // keyboard delta here, avoiding a second navigation-bar inset.
  const composerInsetStyle = useKeyboardBottomInsetStyle(props.safeAreaBottom, true);

  async function send(text: string) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setPendingStudent(text);
    setAwaitingFirstToken(true);
    setTurnError(null);

    const clientMessageId = resolveClientMessageId(pendingClientMessageIdRef.current);
    pendingClientMessageIdRef.current = clientMessageId;

    try {
      const fullReply = await apiClient.postExchange(props.token, props.sessionId, text, {
        signal: controller.signal,
        clientMessageId,
        onChunk: (accumulated) => {
          setAwaitingFirstToken(false);
          setStreamingReply(accumulated);
        },
      });
      if (controller.signal.aborted) return;
      pendingClientMessageIdRef.current = null;
      setStreamingReply(fullReply);
      setPendingStudent(null);
      setAwaitingFirstToken(false);
      setDone(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      setAwaitingFirstToken(false);
      setStreamingReply(null);

      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      if (isQuotaExceeded(err)) {
        pendingClientMessageIdRef.current = null;
        setPendingStudent(null);
        setTurnError(t.study.quotaExceeded);
        return;
      }
      if (err instanceof ApiError && shouldCheckIfTurnLanded(err.code)) {
        try {
          const fresh = await apiClient.getSession(props.token, props.sessionId);
          const freshTurns = fresh.exchanges.map((ex) => ({
            id: ex.id,
            timestamp: ex.timestamp,
            studentMessage: ex.studentMessage,
            tutorReply: ex.tutorReply,
          }));
          if (findLandedTurn(freshTurns, text)) {
            pendingClientMessageIdRef.current = null;
            setPendingStudent(null);
            setTurnError(null);
            setDone(true);
            return;
          }
        } catch {
          // best-effort
        }
      }
      setTurnError(turnErrorCopy(err));
    } finally {
      sendingRef.current = false;
    }
  }

  function retry() {
    if (pendingStudent === null) return;
    setTurnError(null);
    void send(pendingStudent);
  }

  const busy = pendingStudent !== null && turnError === null;

  const ideas = props.ideas.map((idea) => clipIdea(idea)).filter(Boolean);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ color: colors.foreground, fontSize: typography.title.fontSize, fontWeight: typography.weights.bold, lineHeight: typography.title.lineHeight }}>
            {t.guided.explainPrompt(props.topicTitle)}
          </Text>
          <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
            {t.guided.explainHint}
          </Text>
          {ideas.length > 0 ? (
            <View style={{ gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised }}>
              <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
                {t.guided.explainIdeasLabel}
              </Text>
              {ideas.map((idea) => (
                <Text key={idea} style={{ color: colors.foreground, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
                  {idea}
                </Text>
              ))}
            </View>
          ) : null}
          {pendingStudent ? <StudentBubble text={pendingStudent} animate /> : null}
          {awaitingFirstToken ? <ThinkingDots /> : null}
          {streamingReply ? <TutorMessage text={streamingReply} animate={!done} /> : null}
          {turnError ? (
            <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBg, gap: spacing.sm }}>
              <Text style={{ color: colors.danger, fontSize: typography.small.fontSize }}>{turnError}</Text>
              {pendingStudent ? (
                <PrimaryButton label={t.study.retrySend} onPress={retry} compact />
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {done ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
            <PrimaryButton label={t.guided.continue} onPress={props.onComplete} />
          </View>
        ) : (
          <Animated.View style={composerInsetStyle}>
            <ChatComposer
              onSend={(text) => void send(text)}
              busy={busy}
              placeholder={t.guided.explainPlaceholder}
            />
          </Animated.View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
