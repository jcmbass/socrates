/**
 * Entrance animation for a single NEW chat message (craft spec §5.2, D4):
 * fade + rise 8dp with `springs.settle`, applied ONLY to messages that just
 * arrived — historical messages (already on screen when the chat screen
 * mounts) render already placed, no animation, no stagger (spec explicitly
 * forbids animating a 20-message historical dump).
 *
 * Shared by `StudentBubble`/`TutorMessage`/`TutorMessage.web` — one place
 * owns the mechanism instead of duplicating ~15 lines of reanimated setup
 * three times (spec's "busca el punto único" instruction).
 *
 * MECHANISM (decided here, not prescribed by the spec): this hook has no
 * idea whether a message is "new" — it just plays the animation when
 * `animate` is true, once, on mount, and renders statically when `animate`
 * is false. The "new vs. historical" call is made by the screens
 * (`app/study/[subjectId].tsx`, `app/subjects/[subjectId]/temas/[topicId].tsx`,
 * `app/subjects/[subjectId]/milestones/[milestoneId].tsx`): each keeps a ref
 * populated once, right after its initial session fetch resolves, with the
 * set of exchange ids that were ALREADY there (`initialTurnIdsRef`). Every
 * rendered turn passes `animate={!initialTurnIdsRef.current?.has(turn.id)}`
 * — ids appended later (a real new turn, `local-${Date.now()}`) are never in
 * that set, so they animate; ids from the initial fetch are, so they don't.
 * `pendingStudent`/`streamingReply` bubbles have no id at all yet and are
 * always genuinely new, so screens pass `animate` unconditionally there.
 *
 * Reduce-motion (DF-5.5): unlike D2's Home/D3's SkillTree entrances (which
 * go fully static under reduce-motion — content just appears, no fade),
 * this one STILL animates when `animate` is true: a plain 150ms opacity
 * crossfade with NO rise (spec §5.2 wants an announcement that "something
 * new appeared" preserved even under reduce-motion, just non-vestibular).
 */
import { useEffect } from "react";
import { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { crossfadeTiming, springs } from "../theme/motion";

const MESSAGE_RISE_DP = 8;

export function useMessageEntranceStyle(animate: boolean, reduceMotion: boolean) {
  const startsRisen = animate && !reduceMotion;
  const opacity = useSharedValue(animate ? 0 : 1);
  const translateY = useSharedValue(startsRisen ? MESSAGE_RISE_DP : 0);

  useEffect(() => {
    if (!animate) return; // historical: shared values stay at their resting (already-placed) value forever.
    if (reduceMotion) {
      opacity.value = withTiming(1, crossfadeTiming);
    } else {
      opacity.value = withTiming(1, { duration: springs.settle.duration });
      translateY.value = withSpring(0, springs.settle);
    }
    // Mount-only by design: a message's "is this new" identity is fixed for
    // its whole lifetime (it never flips from new back to historical), so
    // this deliberately never re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}
