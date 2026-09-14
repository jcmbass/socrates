/**
 * A4 sesión de estudio — F1/WP6 Part 2: the chat leaves the mock
 * (lib/mockTutor.ts, deleted) and consumes apps/server for real
 * (`/v1/sessions`, `/v1/sessions/:id/exchanges`, DF-5.2 streaming via
 * `expo/fetch`).
 *
 * C3 "sesiones retomables" (simplified): on mount, list the student's
 * active sessions and reuse the most recently updated one for THIS
 * subject; if none exists, create one. `GET /v1/sessions/:id` returns the
 * full Exchange history, which becomes the transcript — this is what makes
 * "resume after app restart" work with NO local cache at all (C3/O-8: the
 * server is the only source of truth).
 *
 * Turn flow (`send`): quota-exceeded (429) clears the pending student
 * message (nothing was accepted); a safety block is NOT a distinct
 * case — the server sends its static reply in-band as a normal 200 stream
 * (C-backend §3.2) and it renders exactly like any other tutor reply; any
 * other failure (network/5xx/mid-stream drop) PRESERVES the pending
 * message behind a "Reintentar" affordance that resends the exact same
 * text — see i18n/es.ts's `study.*` strings.
 *
 * Math rendering (TutorMessage.tsx): while a reply is still streaming this
 * screen renders it as plain live text (cheap, no WebView reload per
 * chunk — see that component's module doc for why); once the turn
 * completes it swaps to the KaTeX-in-WebView renderer.
 *
 * New-vs-historical message entrance (craft spec §5.2, D4): `initialTurnIds`
 * captures the set of exchange ids that were already on the server the
 * moment this screen's initial fetch resolved (state, not a ref — read
 * during render to decide `animate`, so it has to be state). Every
 * rendered turn passes `animate={!initialTurnIds?.has(id)}` to `StudentBubble`/
 * `TutorMessage` (see `components/useMessageEntrance.ts` for the mechanism);
 * `pendingStudent`/`streamingReply` are always genuinely new, so those two
 * pass `animate` unconditionally.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChatComposer } from "../../components/ChatComposer";
import { MaterialEventMarker } from "../../components/MaterialEventMarker";
import { MaterialIngestBar } from "../../components/MaterialIngestBar";
import { OnboardBackButton } from "../../components/OnboardBackButton";
import { PrimaryButton } from "../../components/PrimaryButton";
import { StudentBubble } from "../../components/StudentBubble";
import { ThinkingDots } from "../../components/ThinkingDots";
import { TutorMessage } from "../../components/TutorMessage";
import { useT } from "../../i18n/react";
import { apiClient } from "../../lib/api/expoClient";
import { ApiError, isQuotaExceeded, isUnauthorized } from "../../lib/api/errors";
import { turnErrorCopy } from "../../lib/turnErrorCopy";
import { findLandedTurn, shouldCheckIfTurnLanded } from "../../lib/turnReconcile";
import { resolveClientMessageId } from "../../lib/clientMessageId";
import type { ActiveSessionSummary, ActivityResult, Exchange, FullStudySession } from "../../lib/api/types";
import { appStore, useAppState } from "../../lib/appStore";
import { interleaveMaterialEvents } from "../../lib/transcriptEvents";
import { useTheme } from "../../theme/useTheme";
import { radius, spacing, typography } from "../../theme/tokens";

/** Just the fields the transcript needs to render — server Exchanges AND the just-completed local turn both fit this. `timestamp` (F2 WQ3 parte C2) is what `../../lib/transcriptEvents.ts`'s `interleaveMaterialEvents` sorts by, alongside `StudySession.materialEvents`. */
interface TranscriptTurn {
  id: string;
  timestamp: string;
  studentMessage: string;
  tutorReply: string;
}

function toTurn(exchange: Exchange): TranscriptTurn {
  return { id: exchange.id, timestamp: exchange.timestamp, studentMessage: exchange.studentMessage, tutorReply: exchange.tutorReply };
}

export default function StudySession_() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();
  const auth = useAppState((s) => s.auth);

  const [session, setSession] = useState<FullStudySession | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [loadError, setLoadError] = useState(false);

  /** Mensaje del estudiante del turno en vuelo (aún no es Exchange — I-12). */
  const [pendingStudent, setPendingStudent] = useState<string | null>(null);
  /** Texto del tutor acumulado mientras stremea; null si no hay turno en vuelo. */
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  /** Set on a retryable turn failure (network/5xx) — null means no error banner. quota_exceeded never sets this (it clears pendingStudent instead, per spec). */
  const [turnError, setTurnError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  /**
   * Guardia de turno en vuelo. DEBE ser ref, no estado: `retry` limpiaba
   * `pendingStudent` y llamaba a `send` en el mismo tick, pero el closure de
   * `send` seguía viendo el valor viejo y abortaba en su propia guardia — el
   * mensaje desaparecía de la pantalla y nunca se enviaba nada.
   */
  const sendingRef = useRef(false);
  /** Stable across retries of the same pending turn (beta-real 10). Cleared on confirm / quota abandon. */
  const pendingClientMessageIdRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  /** Craft spec §5.2 (D4): ids present at the moment of the initial fetch — see module doc. */
  const [initialTurnIds, setInitialTurnIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    const currentAuth = auth;
    if (!currentAuth || !subjectId) return;
    let cancelled = false;

    (async () => {
      setLoadError(false);
      try {
        const active = (await apiClient.listActiveSessions(currentAuth.token)) as ActiveSessionSummary[];
        const existing = active
          .filter((s) => s.subjectId === subjectId)
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];

        const full = existing
          ? await apiClient.getSession(currentAuth.token, existing.id)
          : await withEmptyExchanges(await apiClient.createSession(currentAuth.token, { subjectId }));

        // Fetch activity signals in parallel — A §5.2, sombra F3.
        const activityData = await apiClient.getActivity(currentAuth.token).catch(() => null);

        if (cancelled) return;
        setInitialTurnIds(new Set(full.exchanges.map((ex) => ex.id)));
        setSession(full);
        setTurns(full.exchanges.map(toTurn));
        setActivity(activityData);
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
      abortRef.current?.abort();
    };
  }, [auth, subjectId, reloadKey]);

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
        // §2.5: the turn was never accepted — nothing to retry, nothing was persisted.
        pendingClientMessageIdRef.current = null;
        setPendingStudent(null);
        setTurnError(t.study.quotaExceeded);
        return;
      }
      // Network/5xx/mid-stream drop — PRESERVE the message for a manual retry.
      // ¿Y si "falló" pero en realidad llegó? Un timeout del cliente no
      // cancela el trabajo del servidor: el tutor pudo haber contestado ya.
      // Preguntar por GET (gratis) antes de dejar que el estudiante reenvíe,
      // que es lo que duplicaba el mensaje en la transcripción.
      // `duplicate_turn` (beta-real 10) takes the same path — not a red error.
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
          // El chequeo es best-effort: si tampoco se puede consultar, seguimos
          // al error normal en vez de tragarnos el fallo original.
        }
      }

      // El mensaje del estudiante SE QUEDA en pantalla para que reintentar
      // tenga qué reenviar, y el texto no culpa a su conexión por una caída
      // del proveedor del tutor.
      setTurnError(turnErrorCopy(err));
    } finally {
      sendingRef.current = false;
    }
  }

  function retry() {
    if (pendingStudent === null) return;
    setTurnError(null);
    // No limpiar `pendingStudent`: `send` lo vuelve a fijar, y limpiarlo antes
    // era lo que hacía desaparecer el mensaje sin enviarlo.
    void send(pendingStudent);
  }

  const subjectTitle = session?.subjectNameSnapshot ?? t.common.loading;

  /** W4: `headerShown: false` (convention from W2/W3, applied here too so this legacy subject-level chat matches `temas/[topicId].tsx`/`milestones/[milestoneId].tsx` instead of showing a native header this screen otherwise had no in-page equivalent for) restores its own back control, falling back to `/courses` — this screen (unlike the topic/milestone ones) has no temario-tree parent to return to; it's reached from the older subject-card tap on `courses/[courseId]/index.tsx`. */
  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/courses");
    }
  }

  if (!subjectId) return <Redirect href="/courses" />;
  if (!auth) return <Redirect href="/login" />;

  const busy = pendingStudent !== null;
  const isEmpty = turns.length === 0 && !busy && session !== null;
  const transcriptItems = interleaveMaterialEvents(turns, session?.materialEvents ?? []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.surface }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {session === null && !loadError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : loadError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg }}>
            <Text style={{ color: colors.danger, fontSize: typography.body.fontSize, textAlign: "center" }}>
              {t.study.sessionLoadError}
            </Text>
            <PrimaryButton label={t.common.retry} onPress={() => setReloadKey((k) => k + 1)} />
          </View>
        ) : (
          <>
            {/* W4: in-page header (back button + subject name) replacing the native Stack header, same convention as temas/[topicId].tsx and milestones/[milestoneId].tsx. This legacy screen never had a Dominio/XP/Fuentes row (P4/P5 left it untouched), so the header here is just back+title. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.lg,
                paddingTop: insets.top + spacing.sm,
                paddingBottom: spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <OnboardBackButton onPress={handleBack} />
              <Text
                numberOfLines={1}
                style={{ flex: 1, color: colors.foreground, fontSize: typography.title.fontSize, fontWeight: typography.weights.bold }}
              >
                {subjectTitle}
              </Text>
            </View>

            {/* Señales honestas de actividad — A §5.2, sombra F3: actividad NO logro, cero números del assessor (O-5). */}
            {activity ? (
              <View
                style={{
                  flexDirection: "row",
                  gap: spacing.md,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.xs,
                  backgroundColor: colors.surfaceRaised,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Text
                  style={{
                    color: colors.muted,
                    fontSize: typography.caption.fontSize,
                    lineHeight: typography.caption.lineHeight,
                  }}
                >
                  {t.study.activitySessions(activity.recentSessionCount)}
                </Text>
                <Text
                  style={{
                    color: colors.muted,
                    fontSize: typography.caption.fontSize,
                    lineHeight: typography.caption.lineHeight,
                  }}
                >
                  {t.study.activityExchanges(activity.totalExchangeCount)}
                </Text>
              </View>
            ) : null}
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                flexGrow: 1,
              }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
              keyboardShouldPersistTaps="handled"
            >
              {isEmpty ? (
                <Text
                  style={{
                    color: colors.muted,
                    fontSize: typography.body.fontSize,
                    lineHeight: typography.body.lineHeight,
                    textAlign: "center",
                    marginTop: spacing.xxl,
                  }}
                >
                  {t.study.emptyState}
                </Text>
              ) : null}

              {transcriptItems.map((item) =>
                item.type === "turn" ? (
                  <View key={item.turn.id}>
                    <StudentBubble text={item.turn.studentMessage} animate={!initialTurnIds?.has(item.turn.id)} />
                    <TutorMessage text={item.turn.tutorReply} animate={!initialTurnIds?.has(item.turn.id)} />
                  </View>
                ) : (
                  <MaterialEventMarker key={`material-event-${item.event.materialAssetId}-${item.event.timestamp}`} event={item.event} />
                ),
              )}

              {pendingStudent !== null ? <StudentBubble text={pendingStudent} animate /> : null}
              {awaitingFirstToken ? <ThinkingDots /> : null}
              {streamingReply !== null && streamingReply !== "" ? <TutorMessage text={streamingReply} streaming animate /> : null}

              {turnError ? (
                <View
                  style={{
                    marginTop: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    backgroundColor: colors.dangerBg,
                    gap: spacing.sm,
                  }}
                >
                  <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
                    {turnError}
                  </Text>
                  {pendingStudent !== null ? (
                    <Pressable accessibilityRole="button" onPress={retry}>
                      <Text style={{ color: colors.accent, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>
                        {t.study.retrySend}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            {auth && session ? (
              <MaterialIngestBar
                token={auth.token}
                subjectId={subjectId}
                session={session}
                onSessionUpdated={(updated) => setSession((prev) => (prev ? { ...prev, ...updated } : prev))}
              />
            ) : null}

            <View style={{ paddingBottom: insets.bottom }}>
              <ChatComposer onSend={(text) => void send(text)} busy={busy && turnError === null} />
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

/** POST /v1/sessions returns the StudySession WITHOUT an `exchanges` field (only GET /:id nests it) — a brand-new session has none anyway. */
async function withEmptyExchanges(session: Awaited<ReturnType<typeof apiClient.createSession>>): Promise<FullStudySession> {
  return { ...session, exchanges: [] };
}
