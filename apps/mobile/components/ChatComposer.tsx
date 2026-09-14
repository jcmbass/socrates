/**
 * Message input + send — the A4 thumb-zone surface. Lives pinned to the
 * bottom of the study screen: input grows from one line up to ~4 lines
 * then scrolls INTERNALLY (A4 §4.1 — it never pushes the send button out
 * of comfortable reach). Send button is a 48dp circle (D2 §4.4).
 *
 * Craft spec §2.5 (D1, send button ONLY — the input itself is untouched):
 * press feedback via `PressableScale`; empty/disabled state uses `elevated`
 * background + `muted` glyph, with-text state crossfades to `accent` +
 * `accentContrast` over 150ms (`canSendProgress`, a reanimated shared value
 * + `interpolateColor` — same pattern as `PrimaryButton`'s disabled fade).
 *
 * Craft spec §5.3 (D4): the bar itself now sits on `surfaceRaised` (depth
 * ladder, one rung above the chat's `surface` background — profundidad por
 * capas, no blur) instead of `surface`, with its existing hairline `border`
 * top now reading as an actual seam. The `TextInput` gets the SAME focus
 * treatment `TextField.tsx` uses (border crossfades to `accent` + an
 * `accentLight` halo ring behind it, 150ms) even though it isn't built on
 * `TextField` — this composer's input has no label/error, so wrapping it in
 * `TextField` outright wasn't a fit; the ring mechanics are copied instead
 * of extracted into a shared piece, since `TextField` doesn't factor out a
 * "just the ring" primitive today (documented deviation, minimal diff).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { TextInput, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";

import { useT } from "../i18n/react";
import { useTheme } from "../theme/useTheme";
import { crossfadeTiming } from "../theme/motion";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { PressableScale } from "./PressableScale";
import { SendIcon } from "./icons/SendIcon";

/** ~4 lines of body text + vertical padding. */
const MAX_INPUT_HEIGHT = typography.body.lineHeight * 4 + spacing.sm * 2;
/** Same ring thickness `TextField.tsx` uses. */
const RING_THICKNESS = 2;

export function ChatComposer(props: {
  onSend: (text: string) => void;
  /** Disables send while a tutor turn is in flight. */
  busy: boolean;
  /** Optional control rendered to the left of the text input (e.g. source attachment). */
  leftAccessory?: ReactNode;
  placeholder?: string;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [draft, setDraft] = useState("");
  const focusProgress = useSharedValue(0);

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !props.busy;
  const canSendProgress = useSharedValue(canSend ? 1 : 0);

  useEffect(() => {
    canSendProgress.value = withTiming(canSend ? 1 : 0, crossfadeTiming);
  }, [canSend, canSendProgress]);

  const sendButtonStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(canSendProgress.value, [0, 1], [colors.elevated, colors.accent]),
  }));
  const sendGlyphColor = useDerivedValue(() =>
    interpolateColor(canSendProgress.value, [0, 1], [colors.muted, colors.accentContrast]),
  );

  const handleFocus = useCallback(() => {
    focusProgress.value = withTiming(1, crossfadeTiming);
  }, [focusProgress]);
  const handleBlur = useCallback(() => {
    focusProgress.value = withTiming(0, crossfadeTiming);
  }, [focusProgress]);

  const ringStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(focusProgress.value, [0, 1], ["transparent", colors.accentLight]),
  }));
  const inputBorderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focusProgress.value, [0, 1], [colors.border, colors.accent]),
  }));

  function handleSend() {
    if (!canSend) return;
    setDraft("");
    props.onSend(trimmed);
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surfaceRaised,
      }}
    >
      {props.leftAccessory ? <View style={{ alignSelf: "center" }}>{props.leftAccessory}</View> : null}
      <Animated.View style={[{ flex: 1, borderRadius: radius.lg + RING_THICKNESS, padding: RING_THICKNESS }, ringStyle]}>
        <Animated.View
          style={[
            { borderWidth: 1, borderRadius: radius.lg, backgroundColor: colors.elevated, overflow: "hidden" },
            inputBorderStyle,
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={props.placeholder ?? t.study.inputPlaceholder}
            placeholderTextColor={colors.muted}
            multiline
            accessibilityLabel={props.placeholder ?? t.study.inputPlaceholder}
            style={{
              minHeight: MIN_TOUCH_TARGET,
              maxHeight: MAX_INPUT_HEIGHT,
              color: colors.foreground,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              fontSize: typography.body.fontSize,
              lineHeight: typography.body.lineHeight,
              fontFamily: typography.fontFamily.regular,
            }}
          />
        </Animated.View>
      </Animated.View>
      <View style={{ alignSelf: "center" }}>
        <PressableScale
          accessibilityLabel={t.study.sendA11yLabel}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={handleSend}
          style={[
            {
              width: MIN_TOUCH_TARGET,
              height: MIN_TOUCH_TARGET,
              borderRadius: radius.lg,
              alignItems: "center",
              justifyContent: "center",
            },
            sendButtonStyle,
          ]}
        >
          <SendIcon size={20} colorValue={sendGlyphColor} />
        </PressableScale>
      </View>
    </View>
  );
}
