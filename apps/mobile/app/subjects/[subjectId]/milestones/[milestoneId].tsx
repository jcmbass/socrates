/**
 * P5 — ronda de repaso de un Hito (DF-P05), the screen `temario.tsx`'s
 * `onMilestonePress` used to fill with an honest "próximamente" notice
 * (P4). Tapping a parcial/examen_final now opens a chat scoped to
 * `kind:"milestone"` (`apps/server/src/routes/sessions.ts`): the tutor
 * (a SEPARATE, opt-in prompt — `@buxo/core/milestone-prompt`, R2: never the
 * validated tutor prompt) reviews the cumulative topic scope up to the
 * milestone's `coversUpToOrder`, grounded ONLY in the subject's Fuentes.
 *
 * **NO GATE (DF-P05, load-bearing UX fact of this whole screen):** there is
 * no pass/fail state anywhere here, no blocking of anything else in the
 * app — the persistent banner below says so explicitly, and nothing about
 * finishing (or not finishing, or never starting) this chat changes what
 * the student can do next. Confirmed server-side too: `routes/sessions.ts`
 * skips the assessor/mastery/gamification chain entirely for
 * `kind:"milestone"` turns (see that file's P5 comment) — no XP, no
 * stars, no streak ever derives from this screen.
 *
 * Reuses the exact same turn-send/streaming plumbing as
 * `temas/[topicId].tsx` (see that file's module doc for why this isn't
 * factored into a shared hook yet) — the milestone-specific parts are the
 * header (hito title/kind instead of topic+mastery) and the empty-state
 * copy (invites the student to send anything to kick off the round,
 * rather than fabricating a tutor-authored opening message the student
 * never actually sent — this codebase's established honesty precedent,
 * see `home`/`skillTree`'s "no fake progress" docblocks).
 *
 * New-vs-historical message entrance (craft spec §5.2, D4): same
 * `initialTurnIds` mechanism as `study/[subjectId].tsx`/`temas/[topicId].tsx`
 * (state, not a ref — read during render) — see `components/useMessageEntrance.ts`.
 * No hint chips on this screen
 * (the milestone chat never had any), so §5.4 doesn't apply here.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";

import { ChatComposer } from "../../../../components/ChatComposer";
import { FuentesPill } from "../../../../components/FuentesPill";
import { OnboardBackButton } from "../../../../components/OnboardBackButton";
import { SourcesModal } from "../../../../components/SourcesModal";
import { StudentBubble } from "../../../../components/StudentBubble";
import { ThinkingDots } from "../../../../components/ThinkingDots";
import { TutorMessage } from "../../../../components/TutorMessage";
import { useKeyboardBottomInsetStyle } from "../../../../components/useKeyboardBottomInset";
import { useSourcesIngestOnScreen } from "../../../../components/useSourcesIngestOnScreen";
import { useT } from "../../../../i18n/react";
import { apiClient } from "../../../../lib/api/expoClient";
import { ApiError, isQuotaExceeded, isUnauthorized } from "../../../../lib/api/errors";
import { turnErrorCopy } from "../../../../lib/turnErrorCopy";
import { findLandedTurn, shouldCheckIfTurnLanded } from "../../../../lib/turnReconcile";
import { resolveClientMessageId } from "../../../../lib/clientMessageId";
import type { ActiveSessionSummary, FullStudySession, Temario } from "../../../../lib/api/types";
import { appStore, useAppState } from "../../../../lib/appStore";
import { useTheme } from "../../../../theme/useTheme";
import { radius, spacing, typography } from "../../../../theme/tokens";

interface TranscriptTurn {
  id: string;
  studentMessage: string;
  tutorReply: string;
}

export default function MilestoneSession() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  /** Craft spec regression fix (post-D4): see `useKeyboardBottomInset.ts` module doc. */
  const composerInsetStyle = useKeyboardBottomInsetStyle(insets.bottom);
  const { subjectId, milestoneId, name } = useLocalSearchParams<{ subjectId: string; milestoneId: string; name?: string }>();
  const auth = useAppState((s) => s.auth);

  const [session, setSession] = useState<FullStudySession | null>(null);
  const [temario, setTemario] = useState<Temario | null>(null);
  const [fuentesCount, setFuentesCount] = useState(0);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [fuentesListEpoch, setFuentesListEpoch] = useState(0);

  const sourcesIngest = useSourcesIngestOnScreen({
    token: auth?.token ?? "",
    subjectId: subjectId ?? "",
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
    if (!currentAuth || !subjectId || !milestoneId) return;
    let cancelled = false;

    (async () => {
      setLoadError(false);
      try {
        const active = (await apiClient.listActiveSessions(currentAuth.token)) as ActiveSessionSummary[];
        const existing = active
          .filter((s) => s.subjectId === subjectId && s.milestoneId === milestoneId && s.kind === "milestone")
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];

        const full = existing
          ? await apiClient.getSession(currentAuth.token, existing.id)
          : { ...(await apiClient.createSession(currentAuth.token, { subjectId, milestoneId })), exchanges: [] };

        const [temarioResult, fuentes] = await Promise.all([
          apiClient.getTemario(currentAuth.token, subjectId).catch(() => null),
          apiClient.listFuentes(currentAuth.token, subjectId).catch(() => []),
        ]);

        if (cancelled) return;
        setInitialTurnIds(new Set(full.exchanges.map((ex) => ex.id)));
        setSession(full);
        setTurns(full.exchanges.map((ex) => ({ id: ex.id, studentMessage: ex.studentMessage, tutorReply: ex.tutorReply })));
        setTemario(temarioResult);
        setFuentesCount(fuentes.length);
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
  }, [auth, subjectId, milestoneId, reloadKey]);

  async function refreshFuentesCount() {
    if (!auth || !subjectId) return;
    try {
      const fuentes = await apiClient.listFuentes(auth.token, subjectId);
      setFuentesCount(fuentes.length);
    } catch {
      // Best-effort badge only.
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
      setTurns((prev) => [...prev, { id: `local-${Date.now()}`, studentMessage: text, tutorReply: fullReply }]);
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
      // ¿Y si "falló" pero en realidad llegó? Un timeout del cliente no
      // cancela el trabajo del servidor: el tutor pudo haber contestado ya.
      // Preguntar por GET (gratis) antes de dejar que el estudiante reenvíe,
      // que es lo que duplicaba el mensaje en la transcripción.
      // `duplicate_turn` (beta-real 10) takes the same path — not a red error.
      if (err instanceof ApiError && shouldCheckIfTurnLanded(err.code) && session) {
        try {
          const fresh = await apiClient.getSession(auth.token, session.id);
          const freshTurns = fresh.exchanges.map((ex) => ({
            id: ex.id,
            studentMessage: ex.studentMessage,
            tutorReply: ex.tutorReply,
          }));
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

  /** W4: `headerShown: false` (convention from W2/W3) drops the native back arrow — this restores it, falling back to the subject's temario tree (not `/courses`) since that's always where this screen was reached from. */
  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: "/subjects/[subjectId]/temario", params: { subjectId, name } });
    }
  }

  if (!subjectId || !milestoneId) return <Redirect href="/courses" />;
  if (!auth) return <Redirect href="/login" />;

  const milestone = temario?.milestones.find((m) => m.id === milestoneId) ?? null;
  const milestoneTitle = milestone?.title ?? name ?? t.common.loading;
  const milestoneKindLabel = milestone ? t.hito[milestone.kind] : null;
  const subjectTitle = session?.subjectNameSnapshot ?? t.common.loading;
  const busy = pendingStudent !== null;
  const isEmpty = turns.length === 0 && !busy && session !== null;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {session === null && !loadError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : loadError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg }}>
            <Text style={{ color: colors.danger, fontSize: typography.body.fontSize, textAlign: "center" }}>{t.hito.loadError}</Text>
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
                    {subjectTitle}{milestoneKindLabel ? ` · ${milestoneKindLabel}` : ""}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: typography.title.fontSize, fontWeight: typography.weights.bold }}>
                    {milestoneTitle}
                  </Text>
                </View>
                <FuentesPill
                  count={fuentesCount}
                  ingest={sourcesIngest.ingest}
                  onPress={() => sourcesIngest.setSourcesOpen(true)}
                />
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

              {/* DF-P05: the load-bearing "this doesn't gate anything" reassurance — always visible, never dismissible. */}
              <View style={{ padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.accentLight }}>
                <Text style={{ color: colors.accent, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                  {t.hito.notGatingBanner}
                </Text>
              </View>
            </View>

            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexGrow: 1 }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
              keyboardShouldPersistTaps="handled"
            >
              {isEmpty ? (
                <Text style={{ color: colors.muted, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, textAlign: "center", marginTop: spacing.xxl }}>
                  {t.hito.emptyState}
                </Text>
              ) : null}

              {turns.map((turn) => (
                <View key={turn.id}>
                  <StudentBubble text={turn.studentMessage} animate={!initialTurnIds?.has(turn.id)} />
                  <TutorMessage text={turn.tutorReply} animate={!initialTurnIds?.has(turn.id)} />
                </View>
              ))}

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

            <Animated.View style={composerInsetStyle}>
              <ChatComposer onSend={(text) => void send(text)} busy={busy && turnError === null} />
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
