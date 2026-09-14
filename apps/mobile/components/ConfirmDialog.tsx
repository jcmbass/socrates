/**
 * ConfirmDialog (C2-b) — reusable confirm/cancel modal, extracted from the
 * delete-account dialog that used to live inline in `app/courses/index.tsx`
 * (the ONLY confirm dialog in the app before this). Generic enough for any
 * "are you sure" moment (destructive or not) — `app/perfil.tsx` is today's
 * consumer (account deletion), but nothing here is delete-account-specific.
 *
 * ── PHYSICS (apple-design skill) ────────────────────────────────────────
 * A centered alert, not a sheet (`SourcesModal.tsx`'s bottom-sheet physics
 * don't apply — this dialog has no drag/momentum origin to anchor to; it
 * appears in response to a tap wherever the trigger happens to be, so a
 * center-scale materialize reads more honest than sliding from an edge).
 * - Entry: opacity 0→1 (200ms timing) + scale 0.95→1 via `springs.settle`
 *   (critically damped, no overshoot — this is a state transition, not a
 *   flick/drag with momentum to preserve; skill §4's "overshoot only when
 *   the gesture itself carried momentum").
 * - Exit: the exact reverse (skill §7 spatial symmetry) — scale back to
 *   0.95 + fade out, THEN unmount (same "animate, then close" ordering
 *   `SourcesModal` documents, via the `mounted`/`props.visible` decouple
 *   below).
 * - Reduce-motion: no scale at all, opacity-only cross-fade (skill §14) —
 *   same non-vestibular substitution `SourcesModal` uses.
 * - Tap-on-scrim does NOT dismiss: unlike `SourcesModal` (a browse/list
 *   sheet), a confirm dialog's whole point is making the two choices
 *   deliberate — an accidental scrim tap silently discarding "delete my
 *   account" would be an anti-pattern (skill §16 Agency: forgiveness via
 *   explicit choices, not an accidental miss-tap).
 *
 * ── DESIGN.md §8 (controles destructivos) ───────────────────────────────
 * The confirm button gets its OWN affordance (a filled `dangerBg` surface,
 * only when `destructive`) at `MIN_TOUCH_TARGET` height — never bare red
 * text floating over other content the way the old home-header link was.
 * Cancel and confirm are two separate, fully-boxed controls stacked with
 * `spacing.sm` between them: neither's hit area can bleed into the other's
 * label or into the status text above (`errorMessage`/busy row).
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
} from "react-native-reanimated";

import { springs } from "../theme/motion";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { PressableScale } from "./PressableScale";

const DIALOG_FADE_TIMING = { duration: 200 } as const;
const PANEL_SCALE_FROM = 0.95;
const PANEL_SCALE_RESTING = 1;

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Filled `dangerBg`/`danger` affordance on the confirm button (DESIGN.md §8). Defaults to the neutral accent treatment. */
  destructive?: boolean;
  /** While true: confirm/cancel are replaced by a spinner (+ optional `busyLabel`) and both buttons stop responding. */
  busy?: boolean;
  /** Text next to the spinner while `busy` (e.g. "Eliminando tu cuenta…"). Omit for a bare spinner. */
  busyLabel?: string;
  /** Inline error from a failed previous attempt (e.g. network failure) — shown above the buttons, `colors.danger`. */
  errorMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  // Same decouple pattern as `SourcesModal`: the actual `<Modal visible=…>`
  // driver (`mounted`) lags `props.visible` on close so the exit animation
  // can finish before the Modal unmounts.
  const [mounted, setMounted] = useState(props.visible);
  const opacity = useSharedValue(props.visible ? 1 : 0);
  const scale = useSharedValue(props.visible ? PANEL_SCALE_RESTING : PANEL_SCALE_FROM);

  const [committedVisible, setCommittedVisible] = useState(props.visible);
  if (props.visible !== committedVisible) {
    setCommittedVisible(props.visible);
    if (props.visible) setMounted(true);
  }

  useEffect(() => {
    if (props.visible) {
      opacity.value = withTiming(1, DIALOG_FADE_TIMING);
      scale.value = reduceMotion ? PANEL_SCALE_RESTING : withSpring(PANEL_SCALE_RESTING, springs.settle);
    } else {
      opacity.value = withTiming(0, DIALOG_FADE_TIMING, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
      scale.value = reduceMotion ? PANEL_SCALE_FROM : withSpring(PANEL_SCALE_FROM, springs.settle);
    }
    // Deliberately keyed on `props.visible` alone (same reasoning as
    // `SourcesModal`): each run reads the latest `reduceMotion` from its
    // own render's closure; running once on initial mount is a no-op here
    // too (closing an already-unmounted dialog touches nothing visible).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: opacity.value * 0.5 }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: reduceMotion ? [] : [{ scale: scale.value }],
  }));

  const busy = props.busy ?? false;
  const destructive = props.destructive ?? false;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={() => !busy && props.onCancel()}>
      <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg }}>
        <Animated.View
          style={[
            { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000" },
            scrimStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              backgroundColor: colors.surfaceRaised,
              borderRadius: radius.lg,
              padding: spacing.lg,
              gap: spacing.md,
            },
            panelStyle,
          ]}
        >
          <Text
            style={{
              color: colors.foreground,
              fontSize: typography.title.fontSize,
              lineHeight: typography.title.lineHeight,
              fontWeight: typography.weights.bold,
            }}
          >
            {props.title}
          </Text>
          <Text style={{ color: colors.muted, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight }}>
            {props.body}
          </Text>
          {props.errorMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.danger, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}
            >
              {props.errorMessage}
            </Text>
          ) : null}
          {busy ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: MIN_TOUCH_TARGET }}>
              <ActivityIndicator color={colors.accent} />
              {props.busyLabel ? (
                <Text style={{ color: colors.muted, fontSize: typography.small.fontSize }}>{props.busyLabel}</Text>
              ) : null}
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <PressableScale
                accessibilityLabel={props.confirmLabel}
                onPress={props.onConfirm}
                style={{
                  minHeight: MIN_TOUCH_TARGET,
                  borderRadius: radius.md,
                  backgroundColor: destructive ? colors.dangerBg : colors.accent,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: spacing.md,
                }}
              >
                <Text
                  style={{
                    color: destructive ? colors.danger : colors.accentContrast,
                    fontSize: typography.small.fontSize,
                    fontWeight: typography.weights.semibold,
                  }}
                >
                  {props.confirmLabel}
                </Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel={props.cancelLabel}
                onPress={props.onCancel}
                style={{
                  minHeight: MIN_TOUCH_TARGET,
                  borderRadius: radius.md,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: spacing.md,
                }}
              >
                <Text style={{ color: colors.muted, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>
                  {props.cancelLabel}
                </Text>
              </PressableScale>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
