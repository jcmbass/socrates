/**
 * P4 "estudios" — árbol de temario de una materia (`assets/estudios.html`).
 * Reached by tapping a subject card on the home screen
 * (`app/courses/index.tsx`, redesigned in P4 — see its module doc for why
 * the route stays "/courses" while the content became the home screen).
 *
 * The subject's display name travels as a route param (`name`) set by the
 * caller instead of a second network round-trip — there is no
 * `GET /v1/subjects/:id` in the WP5 contract (same reasoning
 * `courses/[courseId]/index.tsx` already documents for courses), and
 * adding one is out of this phase's scope (R3). A direct deep-link without
 * `name` falls back to the generic title.
 *
 * Tapping a topic navigates to P5's topic-scoped chat
 * (`/subjects/[subjectId]/temas/[topicId]`, DF-P12) — a NEW screen, not
 * `/study/[subjectId]` (that legacy subject-level chat is untouched, still
 * reachable from `courses/[courseId]/index.tsx`'s older subject-card tap).
 * Tapping a hito navigates to P5's milestone review-round chat
 * (`/subjects/[subjectId]/milestones/[milestoneId]`, DF-P05) — this
 * REPLACES the "próximamente" placeholder P4 shipped here (the ephemeral
 * `notice` banner that rendered it is removed along with it — nothing else
 * on this screen used that mechanism, so it's gone rather than left dead).
 *
 * **W3 changes:**
 * 1. Native header replaced with an in-page one (`headerShown: false`,
 *    convention established in W2's onboarding steps): back button
 *    (`OnboardBackButton` — despite the name it's a generic "‹" control
 *    with zero onboarding-specific logic, so reusing it directly here beats
 *    duplicating an identical component under a new name) + "TEMARIO"
 *    eyebrow + subject name + a progress bar ("Tema X / N · P%",
 *    `lib/skillTree.ts`'s `deriveTemarioProgress` — done-count over total
 *    topics, milestones never counted).
 * 2. `SkillTree` itself became a zigzag/glow game map — see that
 *    component's doc.
 * 3. A bottom "Continuar: <título>" CTA (mockup precedent) appears
 *    whenever there's a recommended topic (`resolveRecommendedTopicId`);
 *    hidden once every topic is done or the temario is empty — never a
 *    dishonest affordance pointing at nothing.
 * 4. **404-vs-real-error branch (bug #3 fix, tracked since the W0 harness
 *    DEVLOG entry):** a subject with NO temario at all returns
 *    `ApiError.code === "not_found"` from `getTemario` — that used to fall
 *    into the same generic `error` branch as a real network/server
 *    failure, showing "No pudimos cargar el temario" + Reintentar with no
 *    way forward. Now it's a separate `notFound` state with a friendly
 *    empty screen offering "Subir PDF" / "Manual" / "Reintentar" for BOTH
 *    missing temario (404) AND an empty orphan row left by a failed generate
 *    (beta-real 06). Manual opens the shared `TemarioTopicEditor` (same as
 *    onboard paso-3) — creating only when no row exists yet (POST conflicts
 *    if one already does). Fuentes are reloaded so retry survives app restart.
 *
 * **Autoscroll de entrada (2026-08-06):** la pantalla abre arriba y, tras
 * `temarioAutoscroll.delayMs` (`theme/motion.ts`), scrollea sola hasta que
 * el tema recomendado quede centrado en el viewport — la Y del centro la
 * reporta `SkillTree.onRecommendedCenterY` apoyándose en la geometría
 * determinista del rail (`lib/skillTreeRail.ts`). El recorrido usa easing
 * "elevador" (ease-in-out cubic: arranque lento, desaceleración fuerte al
 * llegar — pedido del founder), conducido frame a frame por
 * `autoScrollDriver` + `useAnimatedReaction` porque la curva del
 * `scrollTo` nativo no es configurable. El destino no se calcula acá: lo
 * decide `lib/temarioAutoscroll.ts` (puro y con tests de mutación), que
 * devuelve `null` cuando no hay que moverse — sin recomendado, sin scroll
 * posible (pocos temas), el estudiante ya scrolleó, o el recorrido sería
 * despreciable. Un gesto lo cancela al instante (`onBeginDrag` →
 * `cancelAnimation`) y corre UNA sola vez por visita (`autoScrolledRef`).
 * La espera arranca cuando el layout queda medido por primera vez y NO se
 * reprograma con medidas posteriores (las medidas viven en refs, no en
 * estado). Bajo reduce-motion el salto es instantáneo (DESIGN.md §6).
 * Durante el travel `isScrolling` queda en true para que el `GlowRing` ceda
 * frames (mismo criterio device-e13 de `glowScrollPauseDebounce`),
 * soltándose en el callback de completado.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  scrollTo as reanimatedScrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CollapsibleUnitSection } from "../../../components/CollapsibleUnitSection";
import { FuentesPill } from "../../../components/FuentesPill";
import { OnboardBackButton } from "../../../components/OnboardBackButton";
import { PrimaryButton } from "../../../components/PrimaryButton";
import { SkillTree } from "../../../components/SkillTree";
import { SourcesModal } from "../../../components/SourcesModal";
import { TemarioTopicEditor } from "../../../components/TemarioTopicEditor";
import { useIngestToFuente } from "../../../components/useIngestToFuente";
import { useSourcesIngestOnScreen } from "../../../components/useSourcesIngestOnScreen";
import { useT } from "../../../i18n/react";
import { apiClient } from "../../../lib/api/expoClient";
import { ApiError, isUnauthorized } from "../../../lib/api/errors";
import type { Fuente, SeedAttribution, Temario } from "../../../lib/api/types";
import { appStore, useAppState } from "../../../lib/appStore";
import { createManualTemario, generateTemarioForSubject } from "../../../lib/onboardFlow";
import { moveOrderedId, orderedTopicIds, sortedTopics } from "../../../lib/onboardTemario";
import { retryGenerateTemarioFromFuente, type PdfToTemarioErrorKind } from "../../../lib/pdfToTemario";
import { skillTreeIngestErrorCopy } from "../../../lib/ingestErrorCopy";
import { ingestCancelLabel, ingestStatusMessage } from "../../../lib/ingestStatusMessage";
import { isIngestAwaitingServer, isIngestBusy } from "../../../lib/materialIngestState";
import { deriveTemarioProgress, resolveRecommendedTopicId } from "../../../lib/skillTree";
import { resolveAutoScrollTarget } from "../../../lib/temarioAutoscroll";
import { findUnitGroupForTopic, groupTopicsByUnit, seedLevelFromCatalogKey } from "../../../lib/temarioGroups";
import { isSubjectSourcesEntryActive, sourcesReconcileSubjectId } from "../../../lib/subjectSourcesEntry";
import { isTemarioEffectivelyEmpty, pickRetryFuente } from "../../../lib/temarioEmpty";
import { glowScrollPauseDebounce, springs, temarioAutoscroll } from "../../../theme/motion";
import { useReduceMotion, useTheme } from "../../../theme/useTheme";
import { radius, spacing, typography } from "../../../theme/tokens";

/**
 * Progress bar fill (D3, craft spec §4.3): the inner bar's LAYOUT width is
 * already `${percent}%` (a static box, so no layout-affecting animation)
 * and this hook only animates its `transform: scaleX` from 0 → 1 with
 * `springs.settle` on mount — never `width` (D3 spec explicitly: "NO
 * width"). `transformOrigin: "left"` (RN 0.86/Fabric supports this style
 * prop directly) makes the scale grow from the bar's start instead of its
 * center, so it reads as "filling in" left-to-right rather than expanding
 * from the middle. Mount-only (empty deps) — same reasoning as
 * `SkillTree.tsx`'s `useNodeEntrance`: this header only mounts once per
 * real screen visit, no `hasEntered` boolean needed.
 */
function useProgressFillStyle(reduceMotion: boolean) {
  const scale = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSpring(1, springs.settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));
}

function ScreenHeader(props: {
  name: string;
  /** C2-d — "bachillerato" | "universidad" for a seed subject; `null` for the student's own subject (no caption). */
  seedLevel: "bachillerato" | "universidad" | null;
  progress: { doneCount: number; total: number; percent: number };
  onBack: () => void;
  topInset: number;
  /**
   * Obs. 2a de la beta cerrada: la píldora "Fuentes" a nivel MATERIA — la
   * misma que ya viven los chats de tema/hito, en la misma esquina. Llega
   * como slot (no como props sueltas) para que este header siga sin saber
   * nada de ingesta. `null` mientras la entrada no corresponde
   * (`lib/subjectSourcesEntry.ts`).
   */
  sourcesSlot?: ReactNode;
}) {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const { progress } = props;
  const fillStyle = useProgressFillStyle(reduceMotion);
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: props.topInset + spacing.md, gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <OnboardBackButton onPress={props.onBack} />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.accent,
              fontSize: typography.eyebrow.fontSize,
              lineHeight: typography.eyebrow.lineHeight,
              letterSpacing: typography.eyebrow.letterSpacing,
              fontWeight: typography.weights.bold,
            }}
          >
            {t.skillTree.title.toUpperCase()}
          </Text>
          <Text style={{ color: colors.foreground, fontSize: typography.title.fontSize, lineHeight: typography.title.lineHeight, fontWeight: typography.weights.bold }}>
            {props.name}
          </Text>
          {props.seedLevel ? (
            <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
              {t.catalog.stages[props.seedLevel]}
            </Text>
          ) : null}
        </View>
        {props.sourcesSlot ?? null}
      </View>

      {progress.total > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1, height: 6, borderRadius: radius.full, backgroundColor: colors.border, overflow: "hidden" }}>
            <Animated.View
              style={[
                { width: `${progress.percent}%`, height: "100%", borderRadius: radius.full, backgroundColor: colors.accent, transformOrigin: "left" },
                fillStyle,
              ]}
            />
          </View>
          <Text
            style={{
              color: colors.muted,
              fontSize: typography.eyebrow.fontSize,
              lineHeight: typography.eyebrow.lineHeight,
              letterSpacing: typography.eyebrow.letterSpacing,
              fontWeight: typography.weights.semibold,
              fontVariant: [...typography.tabularNums],
            }}
          >
            {t.skillTree.progressLabel(progress.doneCount, progress.total, progress.percent)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function pdfErrorCopy(kind: PdfToTemarioErrorKind | "safety", serverMessage = ""): string {
  return skillTreeIngestErrorCopy(kind, serverMessage);
}

function EmptyNoTemario(props: {
  creating: boolean;
  progressMessage: string | null;
  createError: string | null;
  canRetryGenerate: boolean;
  onManual: () => void;
  onUploadPdf: () => void;
  onRetryGenerate: () => void;
  onCancelIngest?: () => void;
  cancelIngestLabel?: string;
  cancelIngestHint?: string | null;
}) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={{ color: colors.foreground, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, textAlign: "center", fontWeight: typography.weights.semibold }}>
          {t.skillTree.emptyState.title}
        </Text>
        <Text style={{ color: colors.muted, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight, textAlign: "center" }}>
          {t.skillTree.emptyState.subtitle}
        </Text>
      </View>

      {props.creating ? (
        <View style={{ gap: spacing.sm, alignItems: "center" }}>
          <ActivityIndicator color={colors.accent} />
          {props.progressMessage ? (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: typography.caption.fontSize, textAlign: "center" }}>
              {props.progressMessage}
            </Text>
          ) : null}
          {props.cancelIngestHint ? (
            <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, textAlign: "center", maxWidth: 320 }}>
              {props.cancelIngestHint}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center" }}>
            {props.onCancelIngest ? (
              <EmptyStateButton label={props.cancelIngestLabel ?? t.materialIngest.cancel} onPress={props.onCancelIngest} />
            ) : null}
            <EmptyStateButton label={t.skillTree.emptyState.manual} onPress={props.onManual} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center" }}>
          {props.canRetryGenerate ? (
            <EmptyStateButton label={t.skillTree.emptyState.retryGenerate} onPress={props.onRetryGenerate} />
          ) : (
            <EmptyStateButton label={t.skillTree.emptyState.uploadPdf} onPress={props.onUploadPdf} />
          )}
          <EmptyStateButton label={t.skillTree.emptyState.manual} onPress={props.onManual} />
        </View>
      )}

      {props.createError ? (
        <Text style={{ color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, textAlign: "center" }}>
          {props.createError}
        </Text>
      ) : null}
    </View>
  );
}

function EmptyStateButton(props: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.accentLight : "transparent",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.lg,
      })}
    >
      <Text style={{ color: colors.foreground, fontSize: typography.small.fontSize, fontWeight: typography.weights.medium }}>{props.label}</Text>
    </Pressable>
  );
}

/**
 * Local screen shape: the domain `Temario` plus the two response-only
 * signals `GET /v1/temario/:subjectId` adds (`lib/api/types.ts`'s
 * `TemarioWithVisibility` — visibility from plan-xp-progreso Fase 2,
 * `seedCatalogKey`/`seedAttribution` from C2-d). All three stay OPTIONAL
 * here (not required) because the write endpoints this screen also calls
 * (`createManualTemario`/`generateTemarioForSubject`/
 * `retryGenerateTemarioFromFuente`) return a plain `Temario` with none of
 * them — those call sites re-merge the PREVIOUS state's seed fields back in
 * (see `runGenerate`/`handleManualCreate`/`handleRetryGenerate` below) so a
 * seed subject's header/footer don't blank out if its temario is ever
 * regenerated from empty, an edge case that shouldn't happen in practice
 * (a seed subject's temario is populated at activation, not through these
 * flows) but costs nothing to guard against here.
 */
type TemarioScreenState = Temario & {
  visibility?: "shadow" | "visible";
  seedCatalogKey?: string | null;
  seedAttribution?: SeedAttribution | null;
};

export default function SubjectTemario() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  /**
   * Scroll state for `SkillTree`'s `GlowRing` pause (device-e13 finding: the
   * pulse composited over this scrolling list cost 100% of frames on low-end
   * hardware — see `components/SkillTree.tsx`'s module doc). Everything here
   * lives on the UI thread: the handler is a worklet and both values are
   * shared values, so a scroll gesture never re-renders React.
   *
   * `settleToken` is the fallback timer described in `glowScrollPauseDebounce`:
   * a short drag can end with no residual velocity, so `onMomentumEnd` never
   * fires — the delayed zero-duration timing resumes the glow anyway, and its
   * completion callback is skipped (`finished === false`) when a new gesture
   * cancels it.
   */
  const isScrolling = useSharedValue(false);
  const settleToken = useSharedValue(0);

  /**
   * Autoscroll de entrada (ver module doc): `scrollY` solo existe para
   * saber, al momento de disparar, si el estudiante ya scrolleó por su
   * cuenta (se lee desde JS en el timeout — los shared values se pueden
   * leer en ambos hilos). `autoScrolledRef` garantiza una sola corrida por
   * visita aunque el temario se recargue (`reloadKey`).
   */
  const scrollY = useSharedValue(0);
  const scrollRef = useAnimatedRef<ScrollView>();
  const autoScrolledRef = useRef(false);
  /**
   * Driver del autoscroll con easing elevador: -1 = idle (el scroll es del
   * estudiante); mientras vale >= 0, la reacción de abajo dicta la posición
   * frame a frame desde el hilo de UI. Es un shared value SEPARADO de
   * `scrollY` porque `onScroll` escribe este último en cada frame — si el
   * `withTiming` animara `scrollY`, el handler pisaría la animación.
   */
  const autoScrollDriver = useSharedValue(-1);
  /**
   * Las tres medidas del layout viven en REFS, no en estado: `onLayout` y
   * `onContentSizeChange` se disparan varias veces mientras el árbol asienta,
   * y guardarlas en estado re-renderizaba la pantalla en cada una. Lo único
   * que sube a estado es `measured`, un flip de una sola vía que arranca el
   * reloj cuando las tres existen por primera vez.
   */
  const recommendedCenterYRef = useRef<number | null>(null);
  const scrollViewportRef = useRef(0);
  const scrollContentHeightRef = useRef(0);
  const [measured, setMeasured] = useState(false);

  const noteMeasurement = useCallback(() => {
    if (
      recommendedCenterYRef.current !== null &&
      scrollViewportRef.current > 0 &&
      scrollContentHeightRef.current > 0
    ) {
      setMeasured(true);
    }
  }, []);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
    onBeginDrag: () => {
      cancelAnimation(settleToken);
      // Un gesto del estudiante mata el autoscroll en curso: el callback del
      // timing llega con finished=false y no toca nada (guard abajo) —
      // isScrolling queda en true y lo resuelve el flujo normal del gesto.
      cancelAnimation(autoScrollDriver);
      autoScrollDriver.value = -1;
      isScrolling.value = true;
    },
    onMomentumBegin: () => {
      cancelAnimation(settleToken);
      isScrolling.value = true;
    },
    onMomentumEnd: () => {
      cancelAnimation(settleToken);
      isScrolling.value = false;
    },
    onEndDrag: () => {
      settleToken.value = 1;
      settleToken.value = withDelay(
        glowScrollPauseDebounce.duration,
        withTiming(0, { duration: 0 }, (finished) => {
          "worklet";
          if (finished) isScrolling.value = false;
        }),
      );
    },
  });
  // Mientras el driver esté activo, cada frame del hilo de UI aplica la
  // posición animada al ScrollView real (`animated: false` acá — la curva ya
  // la pone el withTiming del driver; animar de nuevo sería doble easing).
  useAnimatedReaction(
    () => autoScrollDriver.value,
    (y) => {
      if (y >= 0) reanimatedScrollTo(scrollRef, 0, y, false);
    },
  );

  const { subjectId, name } = useLocalSearchParams<{ subjectId: string; name?: string }>();
  const auth = useAppState((s) => s.auth);

  const [temario, setTemario] = useState<TemarioScreenState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [pendingFuente, setPendingFuente] = useState<Fuente | null>(null);
  /** Obs. 2a — cuenta para la píldora "Fuentes" del header; `listEpoch` re-lista el modal cuando adjunta con la hoja cerrada. */
  const [fuentesCount, setFuentesCount] = useState(0);
  const [fuentesListEpoch, setFuentesListEpoch] = useState(0);
  /** Manual path: edit topics outside onboarding (beta-real 06 Fase 2). */
  const [editing, setEditing] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);

  /**
   * C2-d — which unit sections are expanded. Deliberately NOT "which are
   * open" directly: the DEFAULT (the unit holding the temario's
   * globally-recommended topic) is a plain value derived from `temario`
   * every render (`defaultOpenUnitGroup` below) — no state, no effect
   * needed just to mirror it (the "adjust state when a prop/derived-value
   * changes" anti-pattern `react-hooks/set-state-in-effect` flags). This
   * map holds ONLY the student's manual overrides (a tap on a section
   * header), keyed by `unitLabel` (including `null`, the "sin unidad"
   * bucket — `groupTopicsByUnit` guarantees at most one group per label).
   * Reset to empty on a real reload (`reloadKey`) inside the fetch
   * effect's async body below, alongside `setLoading(true)` et al.
   */
  const [unitOverrides, setUnitOverrides] = useState<Map<string | null, boolean>>(new Map());

  const runGenerate = useCallback(
    async (fuente: Fuente, sid: string, token: string) => {
      setCreating(true);
      setPendingFuente(fuente);
      setProgressMessage(t.skillTree.emptyState.buildingProgress);
      setCreateError(null);
      try {
        const result = await generateTemarioForSubject(apiClient, token, sid, fuente.id);
        // Functional update (not `temario` from closure — this callback's
        // deps are just `[t]`): re-merges whatever seed fields the PREVIOUS
        // state carried, see `TemarioScreenState`'s docblock above.
        setTemario((prev) => ({ ...result.temario, seedCatalogKey: prev?.seedCatalogKey ?? null, seedAttribution: prev?.seedAttribution ?? null }));
        setPendingFuente(null);
        setProgressMessage(null);
        setCreateError(null);
        setEditing(false);
      } catch (err) {
        if (isUnauthorized(err)) {
          await appStore.getState().logout();
          router.replace("/login");
          return;
        }
        setCreateError(pdfErrorCopy("generate_failed"));
        setPendingFuente(fuente);
        setProgressMessage(null);
      } finally {
        setCreating(false);
      }
    },
    // `t` (useT) — student-facing copy; recreate on locale change.
    [t],
  );

  const ingest = useIngestToFuente({
    token: auth?.token ?? "",
    errorMessageFor: (kind) => pdfErrorCopy(kind),
    onFuente: async (fuente, sid) => {
      if (!auth) return;
      await runGenerate(fuente, sid, auth.token);
    },
    onError: (kind, message) => {
      setCreating(false);
      setProgressMessage(null);
      setCreateError(message || pdfErrorCopy(kind));
    },
    onCancelled: () => {
      setCreating(false);
      setProgressMessage(null);
    },
  });

  useEffect(() => {
    if (!isIngestBusy(ingest.ingest)) return;
    setProgressMessage(ingestStatusMessage(ingest.ingest));
  }, [ingest.ingest]);

  /**
   * Obs. 2a de la beta cerrada — material de estudio a nivel MATERIA.
   *
   * Es la MISMA composición que ya usan `TopicFreeChat` y la pantalla de
   * hito (`useSourcesIngestOnScreen` + `FuentesPill` + `SourcesModal`), sin
   * una línea de pipeline nueva: acá solo se monta un toque más arriba, en
   * la pantalla a la que se llega con UN toque desde home. Antes de esto,
   * el único camino para subir un PDF a una materia YA configurada pasaba
   * por entrar a un tema concreto y reconocer el clip del composer.
   *
   * Convive con el `useIngestToFuente` de arriba (el del estado vacío)
   * porque los dos hacen cosas distintas con el PDF: aquél GENERA el
   * temario, éste solo adjunta una Fuente. Nunca están activos a la vez —
   * `isSubjectSourcesEntryActive` apaga éste mientras manda aquél, y
   * `sourcesReconcileSubjectId` corta además su reconcile de huérfanos
   * para que no adjunte por su cuenta un material que el otro flujo está
   * por adjuntar (ver `lib/subjectSourcesEntry.ts`).
   */
  const refreshFuentesCount = useCallback(async () => {
    const token = auth?.token;
    if (!token || !subjectId) return;
    try {
      const fuentes = await apiClient.listFuentes(token, subjectId);
      setFuentesCount(fuentes.length);
    } catch {
      // Best-effort, igual que en los chats: la cuenta vieja miente menos
      // que un 0 inventado por un fallo de red.
    }
  }, [auth?.token, subjectId]);

  const sourcesEntryActive = isSubjectSourcesEntryActive({
    loading,
    error,
    temarioEmpty: isTemarioEffectivelyEmpty(temario),
    buildingTemario: creating,
    editing,
  });

  const sourcesIngest = useSourcesIngestOnScreen({
    token: auth?.token ?? "",
    subjectId: sourcesReconcileSubjectId(subjectId, sourcesEntryActive),
    onFuenteAttached: () => {
      setFuentesListEpoch((n) => n + 1);
      void refreshFuentesCount();
    },
  });

  // Cancelar solo tiene sentido mientras corre la ingesta. Durante
  // `runGenerate` (temario-builder) `creating` sigue en true pero cancelar no
  // detendría nada: sería un botón que miente.
  const canCancelIngest = isIngestBusy(ingest.ingest);

  useEffect(() => {
    const currentAuth = auth;
    if (!currentAuth || !subjectId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(false);
      setEditing(false);
      setUnitOverrides(new Map());
      try {
        let nextTemario: TemarioScreenState | null = null;
        try {
          nextTemario = await apiClient.getTemario(currentAuth.token, subjectId);
        } catch (err) {
          if (isUnauthorized(err)) {
            await appStore.getState().logout();
            router.replace("/login");
            return;
          }
          if (!(err instanceof ApiError && err.code === "not_found")) {
            throw err;
          }
          // Missing row — same setup UI as an empty orphan.
          nextTemario = null;
        }
        if (cancelled) return;
        setTemario(nextTemario);

        // Las fuentes se listan SIEMPRE ahora (obs. 2a): con temario vacío
        // alimentan "Reintentar generación", y con temario armado alimentan
        // la cuenta de la píldora del header. Un fallo acá nunca rompe la
        // pantalla — degrada a 0 / sin reintento, igual que antes.
        try {
          const fuentes = await apiClient.listFuentes(currentAuth.token, subjectId);
          if (!cancelled) {
            setFuentesCount(fuentes.length);
            setPendingFuente(isTemarioEffectivelyEmpty(nextTemario) ? pickRetryFuente(fuentes) : null);
          }
        } catch {
          if (!cancelled) {
            setFuentesCount(0);
            setPendingFuente(null);
          }
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth, subjectId, reloadKey]);

  const reduceMotion = useReduceMotion();

  // Autoscroll de entrada (module doc). El reloj arranca UNA vez, cuando el
  // árbol y el viewport quedan medidos por primera vez (`measured`), y no se
  // reprograma: las medidas siguen llegando por refs, así que un
  // `onContentSizeChange` tardío ya no reinicia la espera. Al disparar, la
  // decisión entera vive en `resolveAutoScrollTarget` (pura y testeada) —
  // devuelve `null` en todos los casos en que no hay que moverse.
  useEffect(() => {
    if (!measured || autoScrolledRef.current) return;
    const timeout = setTimeout(() => {
      if (autoScrolledRef.current) return;
      autoScrolledRef.current = true;
      const target = resolveAutoScrollTarget({
        recommendedCenterY: recommendedCenterYRef.current,
        // SkillTree es el primer hijo del contentContainer (padding:
        // spacing.lg), así que su raíz arranca ahí dentro del scrolleable.
        contentTopPadding: spacing.lg,
        viewportHeight: scrollViewportRef.current,
        contentHeight: scrollContentHeightRef.current,
        currentScrollY: scrollY.value,
        viewportAnchor: temarioAutoscroll.viewportAnchor,
        studentScrollTolerance: spacing.xl,
        minTravel: spacing.sm,
      });
      if (target === null) return;
      if (reduceMotion) {
        scrollRef.current?.scrollTo({ y: target, animated: false });
        return;
      }
      isScrolling.value = true;
      // Easing "elevador" (founder 2026-08-06): ease-in-out cubic — arranque
      // lento, crucero, desaceleración fuerte al llegar. El callback solo
      // suelta isScrolling/driver en completado NATURAL: si el estudiante
      // cancela con un gesto (finished=false), su flujo de drag ya es dueño
      // de ambos (onBeginDrag).
      autoScrollDriver.value = scrollY.value;
      autoScrollDriver.value = withTiming(
        target,
        { duration: temarioAutoscroll.travelMs, easing: Easing.inOut(Easing.cubic) },
        (finished) => {
          "worklet";
          if (finished) {
            autoScrollDriver.value = -1;
            isScrolling.value = false;
          }
        },
      );
    }, temarioAutoscroll.delayMs);
    return () => clearTimeout(timeout);
  }, [measured, reduceMotion, scrollY, isScrolling, scrollRef, autoScrollDriver]);

  if (!auth) return <Redirect href="/login" />;
  if (!subjectId) return <Redirect href="/courses" />;

  const displayName = name ?? t.skillTree.title;
  const needsSetup = !loading && !error && isTemarioEffectivelyEmpty(temario) && !editing;
  const progress = deriveTemarioProgress(temario?.topics ?? []);
  const recommendedTopicId = temario ? resolveRecommendedTopicId(temario.topics) : null;
  const recommendedTopic = temario ? temario.topics.find((topic) => topic.id === recommendedTopicId) : undefined;
  const showStars = temario?.visibility === "visible";
  const seedLevel = seedLevelFromCatalogKey(temario?.seedCatalogKey ?? null);
  // C2-d: `null` for a student's own subject (every topic's `unitLabel` is
  // `null`) — the flat `SkillTree` branch below stays byte-identical to
  // before this change in that case (zero regression, per spec).
  const unitGroups = temario ? groupTopicsByUnit(temario) : null;
  // The unit that starts expanded — a plain derived value (no state/effect
  // needed to "sync" it, see `unitOverrides`'s docblock above). `undefined`
  // means "nothing opens by default" (no recommended topic, or it isn't in
  // any group); this is intentionally distinct from a FOUND group whose
  // own `unitLabel` happens to be `null` (the "sin unidad" bucket).
  const defaultOpenUnitGroup =
    unitGroups && recommendedTopicId ? (findUnitGroupForTopic(unitGroups, recommendedTopicId) ?? undefined) : undefined;

  function isUnitOpen(unitLabel: string | null): boolean {
    const override = unitOverrides.get(unitLabel);
    if (override !== undefined) return override;
    return defaultOpenUnitGroup !== undefined && defaultOpenUnitGroup.unitLabel === unitLabel;
  }

  function toggleUnit(unitLabel: string | null) {
    setUnitOverrides((prev) => {
      const next = new Map(prev);
      next.set(unitLabel, !isUnitOpen(unitLabel));
      return next;
    });
  }

  function handleBack() {
    if (editing && !isTemarioEffectivelyEmpty(temario)) {
      setEditing(false);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/courses");
    }
  }

  async function handleManualCreate() {
    if (!auth || !subjectId) return;
    setCreateError(null);
    setProgressMessage(null);
    setEditorError(null);

    // Empty orphan already has a row — POST createTemario would 409.
    if (temario && isTemarioEffectivelyEmpty(temario)) {
      setPendingFuente(null);
      setEditing(true);
      return;
    }

    setCreating(true);
    try {
      const created = await createManualTemario(apiClient, auth.token, subjectId);
      setTemario((prev) => ({ ...created, seedCatalogKey: prev?.seedCatalogKey ?? null, seedAttribution: prev?.seedAttribution ?? null }));
      setPendingFuente(null);
      setEditing(true);
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setCreateError(t.skillTree.emptyState.manualFailed);
    } finally {
      setCreating(false);
    }
  }

  function handleUploadPdf() {
    if (!subjectId) return;
    setCreating(true);
    setCreateError(null);
    setProgressMessage(t.skillTree.emptyState.readingProgress);
    setPendingFuente(null);
    void ingest.startPick(subjectId);
  }

  async function handleRetryGenerate() {
    if (!auth || !subjectId || !pendingFuente) return;
    setCreating(true);
    setProgressMessage(t.skillTree.emptyState.buildingProgress);
    setCreateError(null);
    const result = await retryGenerateTemarioFromFuente(apiClient, auth.token, subjectId, pendingFuente);
    setCreating(false);
    setProgressMessage(null);
    if (result.ok) {
      setTemario((prev) => ({ ...result.temario, seedCatalogKey: prev?.seedCatalogKey ?? null, seedAttribution: prev?.seedAttribution ?? null }));
      setPendingFuente(null);
      setCreateError(null);
      setEditing(false);
      return;
    }
    setCreateError(pdfErrorCopy(result.kind));
    setPendingFuente(result.fuente ?? pendingFuente);
  }

  async function handleAddTopic() {
    if (!auth || !subjectId || !temario) return;
    const title = newTopicTitle.trim();
    if (title.length === 0) return;
    try {
      const topic = await apiClient.createTopic(auth.token, subjectId, title);
      setTemario({ ...temario, topics: [...temario.topics, topic] });
      setNewTopicTitle("");
      setEditorError(null);
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setEditorError(t.onboard.paso3.errors.addTopicFailed);
    }
  }

  async function handleDeleteTopic(topicId: string) {
    if (!auth || !temario) return;
    try {
      await apiClient.deleteTopic(auth.token, topicId);
      setTemario({ ...temario, topics: temario.topics.filter((topic) => topic.id !== topicId) });
      setEditorError(null);
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setEditorError(t.onboard.paso3.errors.deleteTopicFailed);
    }
  }

  async function handleMoveTopic(topicId: string, direction: "up" | "down") {
    if (!auth || !subjectId || !temario) return;
    const currentIds = orderedTopicIds(temario);
    const nextIds = moveOrderedId(currentIds, topicId, direction);
    if (nextIds.join(",") === currentIds.join(",")) return;
    try {
      const topics = await apiClient.reorderTopics(auth.token, subjectId, nextIds);
      setTemario({ ...temario, topics });
      setEditorError(null);
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setEditorError(t.onboard.paso3.errors.reorderFailed);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {ingest.host}
      {sourcesIngest.host}
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader
          name={displayName}
          seedLevel={seedLevel}
          progress={progress}
          onBack={handleBack}
          topInset={insets.top}
          sourcesSlot={
            sourcesEntryActive ? (
              <FuentesPill
                count={fuentesCount}
                ingest={sourcesIngest.ingest}
                onPress={() => sourcesIngest.setSourcesOpen(true)}
              />
            ) : null
          }
        />

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg }}>
            <Text style={{ color: colors.danger, fontSize: typography.body.fontSize, textAlign: "center" }}>{t.skillTree.loadError}</Text>
            <PrimaryButton label={t.common.retry} onPress={() => setReloadKey((k) => k + 1)} />
          </View>
        ) : needsSetup ? (
          <EmptyNoTemario
            creating={creating}
            progressMessage={progressMessage}
            onCancelIngest={canCancelIngest ? () => ingest.cancel() : undefined}
            cancelIngestLabel={canCancelIngest ? ingestCancelLabel(ingest.ingest) : undefined}
            cancelIngestHint={
              canCancelIngest && isIngestAwaitingServer(ingest.ingest) ? t.materialIngest.stopWaitingHint : null
            }
            createError={createError}
            canRetryGenerate={pendingFuente !== null && !creating}
            onManual={() => void handleManualCreate()}
            onUploadPdf={() => handleUploadPdf()}
            onRetryGenerate={() => void handleRetryGenerate()}
          />
        ) : editing && temario ? (
          <View style={{ flex: 1, padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, gap: spacing.md }}>
            <TemarioTopicEditor
              topics={sortedTopics(temario)}
              newTopicTitle={newTopicTitle}
              onChangeNewTopicTitle={setNewTopicTitle}
              onAddTopic={() => void handleAddTopic()}
              onDeleteTopic={(topicId) => void handleDeleteTopic(topicId)}
              onMoveTopic={(topicId, direction) => void handleMoveTopic(topicId, direction)}
              errorMessage={editorError}
              bordered={false}
            />
            {!isTemarioEffectivelyEmpty(temario) ? (
              <PrimaryButton label={t.skillTree.doneEditing} onPress={() => setEditing(false)} />
            ) : null}
          </View>
        ) : (
          <>
            <Animated.ScrollView
              ref={scrollRef}
              onScroll={scrollHandler}
              scrollEventThrottle={16}
              onLayout={(e) => {
                scrollViewportRef.current = e.nativeEvent.layout.height;
                noteMeasurement();
              }}
              onContentSizeChange={(_width, height) => {
                scrollContentHeightRef.current = height;
                noteMeasurement();
              }}
              contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.lg }}
            >
              {temario ? (
                unitGroups ? (
                  <View style={{ gap: spacing.sm }}>
                    {unitGroups.map((group) => {
                      const groupKey = group.unitLabel ?? "__sin_unidad__";
                      const groupTitle = group.unitLabel ?? t.skillTree.noUnitLabel;
                      return (
                        <CollapsibleUnitSection
                          key={groupKey}
                          title={groupTitle}
                          progressLabel={t.skillTree.unitProgressLabel(group.doneCount, group.total)}
                          open={isUnitOpen(group.unitLabel)}
                          onToggle={() => toggleUnit(group.unitLabel)}
                          accessibilityLabel={t.skillTree.unitToggleA11y(groupTitle, group.doneCount, group.total)}
                        >
                          <SkillTree
                            temario={{ topics: group.topics, milestones: group.milestones }}
                            order="syllabus"
                            isScrolling={isScrolling}
                            showStars={showStars}
                            recommendedTopicId={recommendedTopicId}
                            onTopicPress={(topicId) =>
                              router.push({ pathname: "/subjects/[subjectId]/temas/[topicId]", params: { subjectId, topicId, name } })
                            }
                            onMilestonePress={(milestoneId) =>
                              router.push({ pathname: "/subjects/[subjectId]/milestones/[milestoneId]", params: { subjectId, milestoneId, name } })
                            }
                          />
                        </CollapsibleUnitSection>
                      );
                    })}
                  </View>
                ) : (
                  <SkillTree
                    temario={temario}
                    order="gameMap"
                    isScrolling={isScrolling}
                    showStars={showStars}
                    onRecommendedCenterY={(centerY) => {
                      recommendedCenterYRef.current = centerY;
                      noteMeasurement();
                    }}
                    onTopicPress={(topicId) => router.push({ pathname: "/subjects/[subjectId]/temas/[topicId]", params: { subjectId, topicId, name } })}
                    onMilestonePress={(milestoneId) =>
                      router.push({ pathname: "/subjects/[subjectId]/milestones/[milestoneId]", params: { subjectId, milestoneId, name } })
                    }
                  />
                )
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.skillTree.editTemario}
                onPress={() => {
                  setEditorError(null);
                  setEditing(true);
                }}
                style={({ pressed }) => ({
                  alignSelf: "center",
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: colors.accent, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>
                  {t.skillTree.editTemario}
                </Text>
              </Pressable>
              {temario?.seedAttribution ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t.attributions.openSource}
                  onPress={() => {
                    void Linking.openURL(temario.seedAttribution!.sourceUrl).catch(() => {
                      // Best-effort, same as atribuciones.tsx — no toast/alert plumbing here either.
                    });
                  }}
                  style={({ pressed }) => ({
                    alignSelf: "center",
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, textAlign: "center" }}>
                    {t.skillTree.attribution(temario.seedAttribution.title, temario.seedAttribution.publisher, temario.seedAttribution.licenseName)}
                  </Text>
                </Pressable>
              ) : null}
            </Animated.ScrollView>

            {recommendedTopic ? (
              <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.surface }}>
                <PrimaryButton
                  label={t.skillTree.continueCta(recommendedTopic.title)}
                  onPress={() =>
                    router.push({ pathname: "/subjects/[subjectId]/temas/[topicId]", params: { subjectId, topicId: recommendedTopic.id, name } })
                  }
                />
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Obs. 2a — la misma hoja de Fuentes de los chats, ahora también a
          nivel materia. Se monta aunque la píldora esté oculta: si el
          estudiante la abrió y el temario se recargó, cerrarla debe seguir
          animando (misma decisión que el host de arriba). */}
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
  );
}
