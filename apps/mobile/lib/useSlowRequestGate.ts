/**
 * Hook for the ColdStartGate threshold logic — shows the "Despertando a
 * Socrates…" gate when a request takes longer than ~1.5s (feedback inmediato,
 * skill apple-design §3). The gate replaces the generic ActivityIndicator
 * spinner once the threshold is crossed.
 *
 * PURE hook (no RN-native imports beyond react) — the logic is testable under
 * vitest/node via `renderHook` or by testing the state transitions directly.
 *
 * Usage:
 *   const { showGate } = useSlowRequestGate(loading);
 *   if (loading) {
 *     if (showGate) return <ColdStartGate visible />;
 *     return <ActivityIndicator />;
 *   }
 */
import { useEffect, useRef, useState } from "react";

/** Milliseconds of continuous loading before the gate appears. */
export const GATE_THRESHOLD_MS = 1_500;

/**
 * Returns `showGate: true` once `loading` has been true for longer than
 * `GATE_THRESHOLD_MS` (1.5s). Resets to `false` immediately when `loading`
 * becomes false.
 *
 * The gate is NOT shown during the first 1.5s — the app shows the normal
 * ActivityIndicator spinner. This gives fast requests (<1.5s) a snappy feel
 * while still providing the calm "Despertando…" state for slow cold starts.
 */
export function useSlowRequestGate(loading: boolean): { showGate: boolean } {
  const [showGate, setShowGate] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) {
      // Start the threshold timer.
      timerRef.current = setTimeout(() => {
        setShowGate(true);
      }, GATE_THRESHOLD_MS);
    } else {
      // Loading finished (or never started) — reset immediately.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShowGate(false);
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loading]);

  return { showGate };
}
