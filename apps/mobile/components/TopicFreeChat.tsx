/**
 * Free conversation mode for a topic session (D-S01). Extracted from
 * `app/subjects/[subjectId]/temas/[topicId].tsx` so the route file can
 * switch between guided (default) and this UI without a 2000-line mess.
 *
 * Session lookup is scoped to (subjectId, topicId, kind:"topic") — see
 * module doc on the original route file for full P5/DF-P12 context.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";

import { ChatComposer } from "./ChatComposer";
import { ClipIcon } from "./icons/ClipIcon";
import { FuentesPill } from "./FuentesPill";
import { MaterialEventMarker } from "./MaterialEventMarker";
import { OnboardBackButton } from "./OnboardBackButton";
import { PressableScale } from "./PressableScale";
import { SourcesModal } from "./SourcesModal";
import { StudentBubble } from "./StudentBubble";
import { ThinkingDots } from "./ThinkingDots";
import { TutorMessage } from "./TutorMessage";
import { useKeyboardBottomInsetStyle } from "./useKeyboardBottomInset";
import { useSourcesIngestOnScreen } from "./useSourcesIngestOnScreen";
import { XpBadge } from "./XpBadge";
import { useT } from "../i18n/react";
import { apiClient } from "../lib/api/expoClient";
import { ApiError, isQuotaExceeded, isUnauthorized } from "../lib/api/errors";
import { turnErrorCopy } from "../lib/turnErrorCopy";
import { findLandedTurn, shouldCheckIfTurnLanded } from "../lib/turnReconcile";
import { resolveClientMessageId } from "../lib/clientMessageId";
import type { ActiveSessionSummary, FullStudySession, SessionOpening, TemarioWithVisibility, XpSummary } from "../lib/api/types";
import { appStore, useAppState } from "../lib/appStore";
import { deriveXpDisplay } from "../lib/homeCards";
import { interleaveMaterialEvents, prependTutorOpening, shouldRequestTutorOpening } from "../lib/transcriptEvents";
import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";

interface TranscriptTurn {
  id: string;
  timestamp: string;
  studentMessage: string;
  tutorReply: string;
}

function toTurn(exchange: FullStudySession["exchanges"][number]): TranscriptTurn {
  return { id: exchange.id, timestamp: exchange.timestamp, studentMessage: exchange.studentMessage, tutorReply: exchange.tutorReply };
}

export function TopicFreeChat(props: { subjectId: string; topicId: string; subjectName?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const composerInsetStyle = useKeyboardBottomInsetStyle(insets.bottom);
  const { subjectId, topicId, subjectName } = props;
  const auth = useAppState((s) => s.auth);

  const [session, setSession] = useState<FullStudySession | null>(null);
  const [temario, setTemario] = useState<TemarioWithVisibility | null>(null);
  const [xp, setXp] = useState<XpSummary | null>(null);
  const [fuentesCount, setFuentesCount] = useState(0);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [opening, setOpening] = useState<SessionOpening | null>(null);
  const [openingLoading, setOpeningLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [fuentesListEpoch, setFuentesListEpoch] = useState(0);

  const sourcesIngest = useSourcesIngestOnScreen({
    token: auth?.token ?? "",
    subjectId,
    onFuenteAttached: () => {
      setFuentesListEpoch((n) => n + 1);
      void refreshFuentesCount();
    },
  });

  const [pendingStudent, setPendingStudent] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const pendingClientMessageIdRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [initialTurnIds, setInitialTurnIds] = useState<Set<string> | null>(null);
  const openingFromGetRef = useRef(false);

  useEffect(() => {
    const currentAuth = auth;
    if (!currentAuth) return;
    let cancelled = false;
    const openingAbort = new AbortController();
    setOpeningLoading(false);

    (async () => {
      setLoadError(false);
      try {
        const active = (await apiClient.listActiveSessions(currentAuth.token)) as ActiveSessionSummary[];
        const existing = active
          .filter((s) => s.subjectId === subjectId && s.topicId === topicId && s.kind === "topic")
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];

        const full = existing
          ? await apiClient.getSession(currentAuth.token, existing.id)
          : { ...(await apiClient.createSession(currentAuth.token, { subjectId, topicId })), exchanges: [] };

        const [temarioResult, xpResult, fuentes] = await Promise.all([
          apiClient.getTemario(currentAuth.token, subjectId).catch(() => null),
          apiClient.getXp(currentAuth.token, subjectId).catch(() => null),
          apiClient.listFuentes(currentAuth.token, subjectId).catch(() => []),
        ]);

        if (cancelled) return;
        setInitialTurnIds(new Set(full.exchanges.map((ex) => ex.id)));
        setSession(full);
        setTurns(full.exchanges.map(toTurn));
        setTemario(temarioResult);
        setXp(xpResult);
        setFuentesCount(fuentes.length);
        openingFromGetRef.current = Boolean(full.opening?.text);
        setOpening(full.opening ?? null);

        if (
          shouldRequestTutorOpening({
            kind: full.kind,
            topicId: full.topicId,
            exchangeCount: full.exchanges.length,
            hasOpening: Boolean(full.opening?.text),
          })
        ) {
          setOpeningLoading(true);
          try {
            const generated = await apiClient.requestOpening(currentAuth.token, full.id, {
              signal: openingAbort.signal,
            });
            if (cancelled) return;
            setOpening(generated);
          } catch {
            if (cancelled) return;
            // Free chat still works without an opening — empty state remains.
          } finally {
            setOpeningLoading(false);
          }
        }
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          await appStore.getState().logout();
          router.replace("/login");
          return;
        }
        setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      openingAbort.abort();
      abortRef.current?.abort();
      setOpeningLoading(false);
    };
  }, [auth, subjectId, topicId, reloadKey]);

  async function refreshFuentesCount() {
    if (!auth) return;
    try {
      const fuentes = await apiClient.listFuentes(auth.token, subjectId);
      setFuentesCount(fuentes.length);
    } catch {
      // best-effort
    }
  }

  async function send(text: string) {
    if (!auth || !session || sendingRef.current) return;
    sendingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setPendingStudent(text);
    setAwaitingFirstToken(true);
    setTurnError(null);

    const clientMessageId = resolveClientMessageId(pendingClientMessageIdRef.current);
    pendingClientMessageIdRef.current = clientMessageId;

    try {
      const fullReply = await apiClient.postExchange(auth.token, session.id, text, {
        signal: controller.signal,
        clientMessageId,
        onChunk: (accumulated) => {
          setAwaitingFirstToken(false);
          setStreamingReply(accumulated);
        },
      });
      if (controller.signal.aborted) return;

      pendingClientMessageIdRef.current = null;
      setTurns((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, timestamp: new Date().toISOString(), studentMessage: text, tutorReply: fullReply },
      ]);
      setPendingStudent(null);
      setStreamingReply(null);
      setAwaitingFirstToken(false);
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
      if (err instanceof ApiError && shouldCheckIfTurnLanded(err.code) && session) {
        try {
          const fresh = await apiClient.getSession(auth.token, session.id);
          const freshTurns = fresh.exchanges.map(toTurn);
          if (findLandedTurn(freshTurns, text)) {
            pendingClientMessageIdRef.current = null;
            setSession(fresh);
            setTurns(freshTurns);
            setPendingStudent(null);
            setTurnError(null);
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

  function quick(text: string) {
    void send(text);
  }

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: "/subjects/[subjectId]/temario", params: { subjectId, name: subjectName } });
    }
  }

  const topic = temario?.topics.find((tp) => tp.id === topicId) ?? null;
  const topicTitle = topic?.title ?? t.common.loading;
  const subjectTitle = session?.subjectNameSnapshot ?? subjectName ?? t.common.loading;
  const xpDisplay = deriveXpDisplay(xp);
  const busy = pendingStudent !== null;
  const isEmpty = turns.length === 0 && !busy && session !== null && !opening && !openingLoading;
  const transcriptItems = prependTutorOpening(
    interleaveMaterialEvents(turns, session?.materialEvents ?? []),
    opening?.text,
  );

  return (
    <>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {session === null && !loadError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : loadError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg }}>
            <Text style={{ color: colors.danger, fontSize: typography.body.fontSize, textAlign: "center" }}>{t.tema.loadError}</Text>
            <Pressable accessibilityRole="button" onPress={() => setReloadKey((k) => k + 1)}>
              <Text style={{ color: colors.accent, fontWeight: typography.weights.semibold }}>{t.common.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <OnboardBackButton onPress={handleBack} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
                    {subjectTitle}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: typography.title.fontSize, fontWeight: typography.weights.bold }}>
                    {topicTitle}
                  </Text>
                </View>
                <FuentesPill count={fuentesCount} ingest={sourcesIngest.ingest} onPress={() => sourcesIngest.setSourcesOpen(true)} />
              </View>

              {sourcesIngest.ingest.phase === "error" && sourcesIngest.ingest.error && !sourcesIngest.sourcesOpen ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLiveRegion="polite"
                  onPress={() => sourcesIngest.setSourcesOpen(true)}
                  style={{ padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.dangerBg, gap: spacing.xs }}
                >
                  <Text style={{ color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                    {sourcesIngest.ingest.error.message || t.fuentes.errors.unknown}
                  </Text>
                  <Text style={{ color: colors.accent, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
                    {t.fuentes.title}
                  </Text>
                </Pressable>
              ) : null}

              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                {topic && temario?.visibility === "visible" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Text style={{ color: colors.warning, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>{t.tema.masteryLabel}</Text>
                    <View accessibilityLabel={`${topic.stars} de 3 estrellas`} style={{ flexDirection: "row", gap: 2 }}>
                      {[0, 1, 2].map((i) => (
                        <Text key={i} style={{ color: i < topic.stars ? colors.warning : colors.border, fontSize: typography.caption.fontSize }}>★</Text>
                      ))}
                    </View>
                  </View>
                ) : null}
                {xpDisplay.visible ? <XpBadge visible total={xpDisplay.total} /> : null}
              </View>
            </View>

            <View style={{ flex: 1, position: "relative" }}>
              <ScrollView
                ref={scrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingHorizontal: spacing.lg,
                  paddingTop: spacing.md,
                  paddingBottom: spacing.md + 40,
                  flexGrow: 1,
                }}
                onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
                keyboardShouldPersistTaps="handled"
              >
                {isEmpty ? (
                  <Text style={{ color: colors.muted, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, textAlign: "center", marginTop: spacing.xxl }}>
                    {t.study.emptyState}
                  </Text>
                ) : null}

                {transcriptItems.map((item) =>
                  item.type === "opening" ? (
                    <TutorMessage key="tutor-opening" text={item.text} animate={!openingFromGetRef.current} />
                  ) : item.type === "turn" ? (
                    <View key={item.turn.id}>
                      <StudentBubble text={item.turn.studentMessage} animate={!initialTurnIds?.has(item.turn.id)} />
                      <TutorMessage text={item.turn.tutorReply} animate={!initialTurnIds?.has(item.turn.id)} />
                    </View>
                  ) : (
                    <MaterialEventMarker key={`material-event-${item.event.materialAssetId}-${item.event.timestamp}`} event={item.event} />
                  ),
                )}

                {openingLoading && turns.length === 0 && !busy ? <ThinkingDots /> : null}

                {pendingStudent !== null ? <StudentBubble text={pendingStudent} animate /> : null}
                {awaitingFirstToken ? <ThinkingDots /> : null}
                {streamingReply !== null && streamingReply !== "" ? <TutorMessage text={streamingReply} streaming animate /> : null}

                {turnError ? (
                  <View style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBg, gap: spacing.sm }}>
                    <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
                      {turnError}
                    </Text>
                    {pendingStudent !== null ? (
                      <Pressable accessibilityRole="button" onPress={retry}>
                        <Text style={{ color: colors.accent, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>{t.study.retrySend}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </ScrollView>

              <View
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  flexDirection: "row",
                  gap: spacing.sm,
                  paddingHorizontal: spacing.lg,
                  paddingBottom: spacing.xs,
                }}
              >
                <PressableScale
                  disabled={busy}
                  onPress={() => quick(t.tema.hintChipMessage)}
                  style={{ minHeight: 0, minWidth: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.accentLight, opacity: busy ? 0.5 : 1 }}
                >
                  <Text style={{ color: colors.accent, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>{t.tema.hintChip}</Text>
                </PressableScale>
                <PressableScale
                  disabled={busy}
                  onPress={() => quick(t.tema.exampleChipMessage)}
                  style={{ minHeight: 0, minWidth: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.accentLight, opacity: busy ? 0.5 : 1 }}
                >
                  <Text style={{ color: colors.accent, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>{t.tema.exampleChip}</Text>
                </PressableScale>
              </View>
            </View>

            <Animated.View style={composerInsetStyle}>
              <ChatComposer
                onSend={(text) => void send(text)}
                busy={busy && turnError === null}
                leftAccessory={
                  <PressableScale
                    accessibilityLabel={t.tema.attachA11yLabel}
                    onPress={() => sourcesIngest.setSourcesOpen(true)}
                    style={{
                      width: MIN_TOUCH_TARGET,
                      height: MIN_TOUCH_TARGET,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ClipIcon color={colors.accent} size={22} />
                  </PressableScale>
                }
              />
            </Animated.View>
          </>
        )}
      </KeyboardAvoidingView>

      {auth ? (
        <>
          {sourcesIngest.host}
          <SourcesModal
            visible={sourcesIngest.sourcesOpen}
            onClose={() => {
              sourcesIngest.setSourcesOpen(false);
              void refreshFuentesCount();
            }}
            token={auth.token}
            subjectId={subjectId}
            ingest={sourcesIngest.ingest}
            busy={sourcesIngest.busy}
            startPick={sourcesIngest.startPick}
            cancel={sourcesIngest.cancel}
            listEpoch={fuentesListEpoch}
          />
        </>
      ) : null}
    </>
  );
}
