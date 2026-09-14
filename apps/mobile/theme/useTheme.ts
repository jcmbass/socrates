/**
 * Theme + accessibility hooks (D2 §4.3 dark/light desde el día uno,
 * §4.6 reduce-motion).
 *
 * `useTheme` does NOT follow the OS color scheme. Socrates is dark-first by
 * brand decision (DESIGN.md §2): DARK_THEME is returned unconditionally —
 * the app must render dark by default regardless of the device/browser's
 * `prefers-color-scheme`, without waiting for the user to opt in. There is
 * no in-app theme toggle yet; light mode is deferred to a future
 * accessibility/preference exception, not wired to the OS today.
 * `LIGHT_THEME`/`LIGHT_COLORS` stay exported and intact from `./tokens` for
 * that future use — only the OS-based selection here was removed.
 *
 * `useReduceMotion` wires `AccessibilityInfo.isReduceMotionEnabled` by
 * hand, as DF-5.5 requires for RN (it is not inherited from the platform
 * the way `prefers-reduced-motion` is on the web). Any animation added to
 * this app MUST consult it (see components/ThinkingDots.tsx).
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

import { DARK_THEME, type Theme } from "./tokens";

export function useTheme(): Theme {
  return DARK_THEME;
}

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
