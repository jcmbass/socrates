/**
 * Bottom padding for the composer bar that tracks the on-screen keyboard,
 * computed on the UI thread. Fixes the "pan" regression: this project runs
 * edge-to-edge (`IS_EDGE_TO_EDGE_ENABLED=true` in `android/gradle.properties`,
 * transparent status/nav bars in `styles.xml`), which makes
 * `windowSoftInputMode="adjustResize"` a no-op (edge-to-edge disables
 * `decorFitsSystemWindows`, so there's no window left for the OS to
 * "resize"). `"softwareKeyboardLayoutMode": "pan"` (app.json) was tried as
 * a workaround, but `adjustPan` blindly pans the WHOLE window up, ignoring
 * insets — the topic header (which relies on `insets.top` from
 * `SafeAreaProvider`) scrolled off-screen and the transcript rendered under
 * the translucent status bar. Same class of bug as the original
 * header-under-clock bug, reintroduced in the keyboard-open state.
 *
 * Fix: `windowSoftInputMode="adjustResize"` (hand-patched into the
 * ungenerated `android/app/src/main/AndroidManifest.xml` — reanimated's
 * `useAnimatedKeyboard` requires it; `app.json`'s `softwareKeyboardLayoutMode`
 * was updated to `"resize"` to match, but that edit alone has NO runtime
 * effect without `expo prebuild`, which is forbidden in this project — see
 * DEVLOG for the app.json/manifest divergence note) + this hook, which
 * turns the keyboard height into the composer bar's `paddingBottom`. The
 * screen's header is a sibling OUTSIDE the animated container this hook
 * feeds — it's never touched, keeps using `insets.top` exactly as before,
 * in both keyboard states.
 *
 * `isStatusBarTranslucentAndroid`/`isNavigationBarTranslucentAndroid: true`
 * matter beyond naming: `useAnimatedKeyboard`'s native side applies margins
 * to the app's ENTIRE root decor view for as long as any component
 * subscribes (`WindowsInsetsManager.kt`), sized to the system bar insets
 * UNLESS these flags are true. Flipping them would double the header's top
 * offset on top of `SafeAreaProvider`'s own `insets.top` — exactly the
 * regression class this hook exists to close — so don't change these.
 *
 * `Math.max(keyboard.height.value, insetsBottom)`: once the keyboard is
 * open, its reported height is already the full distance from the screen's
 * bottom edge to the top of the keyboard — it already SUBSUMES the nav
 * bar's space (`Keyboard.kt#updateHeight`, given `isNavigationBarTranslucent`),
 * so adding `insetsBottom` on top would double-count it (the exact trap the
 * architect flagged). `max` (not a hard switch at height>0) keeps the value
 * continuous across the open/close transition — no visible snap between
 * "closed: insetsBottom" and "opening: ~0".
 *
 * iOS untouched: both chat screens already wrap themselves in
 * `KeyboardAvoidingView behavior="padding"` on iOS, which already pads for
 * the keyboard. This hook's output collapses to the static `insetsBottom`
 * there (Android-only branch below) so nothing doubles up — not verified
 * on a device (Android-only harness), left as-is deliberately.
 */
import { Platform } from "react-native";
import { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";

import { resolveKeyboardBottomPadding } from "../lib/keyboardInsets";

export function useKeyboardBottomInsetStyle(insetsBottom: number, baseInsetAlreadyApplied = false) {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  // Capture primitives on the JS thread. The worklet must not call a
  // non-worklet helper: that is a Remote Function and kills the process
  // (`[Worklets] Tried to synchronously call a Remote Function`). Play
  // 0.4.2 died here the first time ExplainStep mounted (degraded Economía).
  const isAndroid = Platform.OS === "android";

  return useAnimatedStyle(() => {
    const paddingBottom = resolveKeyboardBottomPadding(
      isAndroid ? "android" : "ios",
      keyboard.height.value,
      insetsBottom,
      baseInsetAlreadyApplied,
    );
    return { paddingBottom };
  });
}
