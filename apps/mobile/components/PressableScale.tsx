/**
 * Unified press-feedback wrapper (craft spec §2.4, D1). apple-design skill
 * §1: a control must respond the instant the finger goes DOWN, not on
 * release — this is the single place in the app that owns that physics so
 * no screen/component reinvents it (see `theme/motion.ts` module doc).
 *
 * Behavior:
 * - `onPressIn`: scale -> 0.97 INSTANTLY (`withTiming`, `pressTiming` from
 *   `theme/motion.ts`, 100ms ease-out). No spring on the way down — Apple's
 *   guidance is immediate feedback, not bounce, on press.
 * - `onPressOut`: spring back to 1 via `springs.snap` (critically damped,
 *   `theme/motion.ts`) — physics belongs on the release, not the press.
 * - Reduce-motion (`useReduceMotion`, DF-5.5): NO scale at all — dims
 *   opacity to 0.85 instead (non-vestibular feedback, skill §14).
 * - `accessibilityRole="button"` by default, overridable via props (e.g.
 *   `SelectableRow` passes `checkbox`/`radio`).
 * - Touch target floor: `MIN_TOUCH_TARGET` (48dp) as a style FLOOR — the
 *   caller's own sizing (all 5 D1 consumers already declare it) wins if
 *   larger; this is a safety net for future consumers that forget it.
 *
 * Integration choice (why this isn't `Animated.createAnimatedComponent(Pressable)`):
 * every existing caller (`PrimaryButton`, `Chip`, `SelectableRow`, ...)
 * already computes its OWN pressed-dependent styling (background tint,
 * border color) via RN's `Pressable` render-prop children
 * (`(state) => ...`). Re-deriving that from reanimated shared values would
 * mean rewriting each caller's color logic. Instead, `Pressable` here stays
 * a plain, unstyled hit-target host (native press detection, `hitSlop`,
 * `disabled`, accessibility — untouched), and the caller's `style` (static
 * OR the `({pressed}) => style` function form, unchanged) is resolved via
 * `Pressable`'s children render-prop and merged into a single inner
 * `Animated.View`, which is the only thing this component actually
 * animates. Net effect: callers add PressableScale with a MINIMAL diff —
 * their existing `style` prop keeps working exactly as before.
 *
 * Reanimated 4 worklets — `useSharedValue`/`useAnimatedStyle`/`withTiming`/
 * `withSpring` all run on web (react-native-web) the same as on device;
 * nothing here is native-only. Only `transform`/`opacity` are animated
 * (moto e13 budget — no layout animation, no blur/shadow).
 */
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type PressableStateCallbackType,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { MIN_TOUCH_TARGET } from "../theme/tokens";
import { pressTiming, springs } from "../theme/motion";
import { useReduceMotion } from "../theme/useTheme";

const PRESSED_SCALE = 0.97;
const RESTING_SCALE = 1;
const RESTING_OPACITY = 1;
const REDUCE_MOTION_PRESSED_OPACITY = 0.85;

const PRESS_IN_TIMING = { duration: pressTiming.duration, easing: Easing.out(Easing.ease) };

// Sourced straight from `Animated.View`'s own prop type (not plain RN
// `StyleProp<ViewStyle>`) so callers can pass either a plain style object/
// array OR one produced by their own `useAnimatedStyle` (e.g. `PrimaryButton`'s
// enabled<->disabled crossfade) without a cast — both end up merged into the
// same style array on the inner `Animated.View` below.
type AnimatedViewStyle = ComponentProps<typeof Animated.View>["style"];
type StyleOrFactory = AnimatedViewStyle | ((state: PressableStateCallbackType) => AnimatedViewStyle);

export interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  children: ReactNode;
  style?: StyleOrFactory;
}

export function PressableScale({ children, style, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(RESTING_SCALE);
  const opacity = useSharedValue(RESTING_OPACITY);

  const animatedStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      // Only touch `opacity` while actually dimmed by a press. At rest
      // (`opacity.value === RESTING_OPACITY`, which holds for anything that
      // never receives a press event — e.g. a `disabled` control) this
      // returns an EMPTY style so it can never collide with a caller's own
      // `opacity` usage. `Chip`'s `opacity: disabled ? 0.6 : 1` is exactly
      // that case: without this guard, a later array entry unconditionally
      // setting `opacity: 1` would silently undo Chip's disabled dimming
      // under reduce-motion.
      return opacity.value === RESTING_OPACITY ? {} : { opacity: opacity.value };
    }
    return { transform: [{ scale: scale.value }] };
  });

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (reduceMotion) {
        opacity.value = withTiming(REDUCE_MOTION_PRESSED_OPACITY, PRESS_IN_TIMING);
      } else {
        scale.value = withTiming(PRESSED_SCALE, PRESS_IN_TIMING);
      }
      onPressIn?.(event);
    },
    [onPressIn, opacity, reduceMotion, scale],
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      if (reduceMotion) {
        opacity.value = withTiming(RESTING_OPACITY, PRESS_IN_TIMING);
      } else {
        scale.value = withSpring(RESTING_SCALE, springs.snap);
      }
      onPressOut?.(event);
    },
    [onPressOut, opacity, reduceMotion, scale],
  );

  return (
    <Pressable accessibilityRole="button" onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
      {(state) => (
        <Animated.View
          style={[
            { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET },
            typeof style === "function" ? style(state) : style,
            animatedStyle,
          ]}
        >
          {children}
        </Animated.View>
      )}
    </Pressable>
  );
}
