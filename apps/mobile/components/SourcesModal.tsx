/**
 * SourcesModal — Fase P5 (DF-P10/DF-P11), maps
 * `assets/tema-tutor-socratico.html`'s "Fuentes de estudio" modal (skin =
 * DESIGN.md tokens, not the mockup's blue). Lists a subject's Fuentes
 * (text-only), lets the student add one from a PDF, and delete one.
 *
 * **Ingest ownership (background-ingest wave):** the state machine and
 * hidden WebView host live on the SCREEN (`useSourcesIngestOnScreen`), not
 * inside this modal. Closing the sheet after picking a PDF must not tear
 * down the pipeline — the student keeps chatting while the pill shows
 * progress. This modal only renders list UI + busy/error feedback from
 * the screen-owned `ingest` props.
 *
 * Photo/image fuentes: NOT wired here — `lib/materialPicker.ts`'s document
 * picker is PDF-only (`type: "application/pdf"`), and no client-side image
 * ingest path exists yet anywhere in this codebase (`routes/materials.ts`'s
 * own docblock flags image ingest as "out of scope for this wave", still
 * true). `Fuente.kind === "image"` is schema-valid and used if a Fuente
 * happens to have that kind, but this modal's "Agregar fuente" only ever
 * creates `kind: "pdf"` ones — a known, pre-existing gap, not something
 * this phase closes (see the DEVLOG "UX default" note).
 *
 * ── SHEET PHYSICS (craft spec §5.1, D4) ─────────────────────────────────
 * This was the app's documented apple-design debt since P5 ("modal Fuentes
 * sin sheet spring"). The mechanism, in one place:
 * - `props.visible` (parent-owned "should be open") and `mounted` (local
 *   state controlling the actual `<Modal visible=…>`) are DECOUPLED on
 *   purpose. Opening: `mounted` flips true immediately, THEN the sheet
 *   springs in. Closing: the exit animation plays FIRST (against the
 *   still-true `mounted`), and only its completion callback (bridged back
 *   via `runOnJS`) flips `mounted` false, which is what actually unmounts
 *   the `Modal`. This is the "anima, luego cierra" ordering the spec
 *   requires — the sheet never just vanishes mid-flight.
 * - Entry: `translateY` from `SHEET_OFFSCREEN_Y` (the window height, so it
 *   starts fully below the fold regardless of the sheet's own — variable,
 *   content-dependent — height) to 0 via `springs.sheet` (the one preset
 *   in the app with overshoot, because a sheet has perceived momentum).
 *   Scrim: opacity 0 → 0.5 via a plain 200ms timing, IN PARALLEL (same
 *   effect, same tick).
 *   Exit: the exact reverse — `translateY` back to `SHEET_OFFSCREEN_Y`,
 *   scrim 0.5 → 0 — same path, per skill §7's spatial-symmetry rule.
 * - Reduce-motion (DF-5.5): the sheet itself NEVER translates — it
 *   cross-fades its own opacity (`contentOpacity`, 200ms) instead. The
 *   scrim's fade is unaffected either way (it was already non-vestibular).
 * - Tap-to-dismiss: the scrim is itself an `Animated.createAnimatedComponent(Pressable)`
 *   (one element doing double duty as the visual scrim AND the tap
 *   target, rather than stacking two absolutely-positioned views) whose
 *   `onPress` calls `props.onClose` — same call the "×" button makes, so
 *   both paths close through the identical parent-driven `visible=false`
 *   → exit-animation → unmount sequence above.
 * - Stretch goal (drag-to-dismiss via gesture-handler) — NOT implemented,
 *   documented deviation: `react-native-gesture-handler` has zero existing
 *   usage anywhere in this app and no `GestureHandlerRootView` wraps the
 *   root layout (`app/_layout.tsx`) yet. Wiring one in for an explicitly
 *   optional stretch would mean touching a shared/global file outside this
 *   phase's file scope for a feature the spec says to skip rather than
 *   risk web/complexity — so it's skipped, per the spec's own escape hatch.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Dimensions, Modal, Pressable, ScrollView, Text, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useT } from "../i18n/react";
import { apiClient } from "../lib/api/expoClient";
import type { Fuente } from "../lib/api/types";
import { fuentesIngestErrorCopy } from "../lib/ingestErrorCopy";
import { hasMeasurableProgress, ingestProgressWidth, ingestStatusMessage } from "../lib/ingestStatusMessage";
import type { IngestState } from "../lib/materialIngestState";
import { springs } from "../theme/motion";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { IngestCancelControl } from "./IngestCancelControl";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Fully below the fold regardless of the sheet's own (content-dependent) height. */
const SHEET_OFFSCREEN_Y = Dimensions.get("window").height;
const SCRIM_MAX_OPACITY = 0.5;
/** Scrim fade + reduce-motion sheet crossfade, both craft spec §5.1's "200ms". */
const SHEET_FADE_TIMING = { duration: 200 } as const;
const HANDLE_WIDTH = 36;
const HANDLE_HEIGHT = 4;

function fuenteIcon(kind: Fuente["kind"]): string {
  return kind === "image" ? "📷" : "📄";
}

export function SourcesModal(props: {
  visible: boolean;
  onClose: () => void;
  token: string;
  subjectId: string;
  /** Screen-owned ingest state — never owned by this modal. */
  ingest: IngestState;
  busy: boolean;
  startPick: (subjectId: string) => Promise<void>;
  cancel: () => void;
  /** Bumped when a fuente finishes attaching while the modal may be closed. */
  listEpoch?: number;
}) {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  // Nav-bar gesture area (or 3-button bar) can overlap the sheet's last
  // line otherwise — same fix pattern as temario.tsx/[topicId].tsx now
  // that `SafeAreaProvider` (app/_layout.tsx) makes this non-zero on-device.
  const insets = useSafeAreaInsets();

  const [fuentes, setFuentes] = useState<Fuente[] | null>(null);
  const [listError, setListError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Actual `<Modal visible=…>` driver — decoupled from `props.visible` so the
  // exit animation below can finish BEFORE the Modal unmounts (module doc).
  const [mounted, setMounted] = useState(props.visible);
  const translateY = useSharedValue(props.visible ? 0 : SHEET_OFFSCREEN_Y);
  const contentOpacity = useSharedValue(props.visible ? 1 : 0);
  const scrimOpacity = useSharedValue(props.visible ? SCRIM_MAX_OPACITY : 0);

  // Opening must mount SYNCHRONOUSLY with the prop flip (the sheet has to
  // exist before it can spring in) — done here, during render, via React's
  // documented "adjusting state when a prop changes" bailout pattern
  // (react.dev), NOT inside the effect below: an effect body that calls
  // setState unconditionally on every run causes an avoidable extra
  // commit. `committedVisible` is the last `props.visible` this component
  // has already reacted to; the closing path (which must wait for the exit
  // animation) stays fully inside the effect, driven by `runOnJS`.
  const [committedVisible, setCommittedVisible] = useState(props.visible);
  if (props.visible !== committedVisible) {
    setCommittedVisible(props.visible);
    if (props.visible) setMounted(true);
  }

  useEffect(() => {
    if (props.visible) {
      if (reduceMotion) {
        contentOpacity.value = withTiming(1, SHEET_FADE_TIMING);
      } else {
        translateY.value = withSpring(0, springs.sheet);
      }
      scrimOpacity.value = withTiming(SCRIM_MAX_OPACITY, SHEET_FADE_TIMING);
    } else {
      if (reduceMotion) {
        contentOpacity.value = withTiming(0, SHEET_FADE_TIMING, (finished) => {
          if (finished) runOnJS(setMounted)(false);
        });
      } else {
        translateY.value = withSpring(SHEET_OFFSCREEN_Y, springs.sheet, (finished) => {
          if (finished) runOnJS(setMounted)(false);
        });
      }
      scrimOpacity.value = withTiming(0, SHEET_FADE_TIMING);
    }
    // Deliberately keyed on `props.visible` alone (see module doc): each run
    // reads the LATEST `reduceMotion` from its own render's closure. Runs
    // once on initial mount too (closing an already-unmounted sheet is a
    // harmless no-op: `mounted` is already false, nothing visible animates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));
  const sheetStyle = useAnimatedStyle(() =>
    reduceMotion ? { opacity: contentOpacity.value } : { transform: [{ translateY: translateY.value }] },
  );

  useEffect(() => {
    if (!props.visible) return;
    let cancelled = false;

    (async () => {
      setListError(false);
      try {
        const list = await apiClient.listFuentes(props.token, props.subjectId);
        if (!cancelled) setFuentes(list);
      } catch {
        if (!cancelled) setListError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible, props.subjectId, props.listEpoch]);

  async function handleDelete(fuente: Fuente) {
    setDeletingId(fuente.id);
    try {
      await apiClient.deleteFuente(props.token, props.subjectId, fuente.id);
      setFuentes((prev) => (prev ?? []).filter((f) => f.id !== fuente.id));
    } catch {
      // Best-effort: leave the item in the list so the student sees the delete didn't take, and can retry.
    } finally {
      setDeletingId(null);
    }
  }

  const { ingest, busy } = props;
  const count = fuentes?.length ?? 0;

  return (
    <Modal visible={mounted} animationType="none" transparent onRequestClose={props.onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* Scrim: doubles as the tap-to-close target (spec §5.1) — one
            element instead of stacking a visual layer + a separate hit-test
            layer. */}
        <AnimatedPressable
          accessibilityLabel={t.fuentes.closeA11yLabel}
          onPress={props.onClose}
          style={[
            { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000" },
            scrimStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              backgroundColor: colors.surfaceRaised,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              maxHeight: "80%",
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: spacing.lg + insets.bottom,
              gap: spacing.md,
            },
            sheetStyle,
          ]}
        >
          <View style={{ alignItems: "center" }}>
            <View
              style={{
                width: HANDLE_WIDTH,
                height: HANDLE_HEIGHT,
                borderRadius: HANDLE_HEIGHT / 2,
                backgroundColor: colors.border,
              }}
            />
          </View>

          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontSize: typography.title.fontSize, lineHeight: typography.title.lineHeight, fontWeight: typography.weights.bold }}>
                {t.fuentes.title}
              </Text>
              <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                {count > 0 ? t.fuentes.subtitle(count) : t.fuentes.subtitleEmpty}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.fuentes.closeA11yLabel}
              onPress={props.onClose}
              style={{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: colors.muted, fontSize: typography.body.fontSize }}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 320 }}>
            {fuentes === null && !listError ? (
              <ActivityIndicator color={colors.accent} />
            ) : listError ? (
              <Text style={{ color: colors.danger, fontSize: typography.small.fontSize }}>{t.fuentes.loadError}</Text>
            ) : count === 0 ? (
              <Text style={{ color: colors.muted, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>{t.fuentes.empty}</Text>
            ) : (
              (fuentes ?? []).map((fuente) => (
                <View
                  key={fuente.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    padding: spacing.md,
                    marginBottom: spacing.sm,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceRaised,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: 20 }}>{fuenteIcon(fuente.kind)}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>
                      {fuente.name}
                    </Text>
                    <Text style={{ color: colors.success, fontSize: typography.caption.fontSize }}>{t.fuentes.processed}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.fuentes.deleteA11yLabel(fuente.name)}
                    disabled={deletingId === fuente.id}
                    onPress={() => void handleDelete(fuente)}
                    style={{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: deletingId === fuente.id ? 0.5 : 1 }}
                  >
                    <Text style={{ color: colors.danger, fontSize: typography.body.fontSize }}>🗑</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>

          {busy ? (
            <View style={{ padding: spacing.sm, gap: spacing.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                {!hasMeasurableProgress(ingest) ? <ActivityIndicator color={colors.accent} /> : null}
                <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: typography.caption.fontSize, flex: 1 }}>
                  {ingestStatusMessage(ingest)}
                </Text>
              </View>
              {hasMeasurableProgress(ingest) ? (
                <View style={{ height: 2, backgroundColor: colors.border, borderRadius: 1 }}>
                  <View
                    style={{
                      height: 2,
                      borderRadius: 1,
                      backgroundColor: colors.accent,
                      width: ingestProgressWidth(ingest),
                    }}
                  />
                </View>
              ) : null}
              <IngestCancelControl state={ingest} onPress={props.cancel} />
            </View>
          ) : null}

          {ingest.phase === "error" && ingest.error ? (
            <View style={{ padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.dangerBg, gap: spacing.xs }}>
              <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: typography.caption.fontSize }}>
                {ingest.error.message ||
                  (ingest.error.kind === "cancelled"
                    ? t.fuentes.errors.unknown
                    : fuentesIngestErrorCopy(ingest.error.kind, ingest.error.message))}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.fuentes.addButtonA11yLabel}
            disabled={busy}
            onPress={() => void props.startPick(props.subjectId)}
            style={{
              minHeight: MIN_TOUCH_TARGET,
              borderRadius: radius.md,
              backgroundColor: busy ? colors.border : colors.accent,
              alignItems: "center",
              justifyContent: "center",
              opacity: busy ? 0.7 : 1,
            }}
          >
            <Text style={{ color: colors.accentContrast, fontSize: typography.body.fontSize, fontWeight: typography.weights.semibold }}>
              {t.fuentes.addButton}
            </Text>
          </Pressable>

          <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
            🔒 {t.fuentes.privacyNote}
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}
