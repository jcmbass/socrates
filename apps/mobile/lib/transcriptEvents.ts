/**
 * Transcript interleaving — F2 WQ3 parte C2, the mobile-client half of the
 * WQ2 acceptance-6 gap closure (`docs/plan-app-multiplataforma/reports/
 * wq2-reporte.md` §4.3). `app/study/[subjectId].tsx` renders one flat list
 * mixing two timestamped sources — chat turns (`Exchange`/the in-flight
 * local turn) and `StudySession.materialEvents` (server-authoritative,
 * `../lib/api/types.ts`'s re-exported `MaterialEvent`) — as a single
 * chronological transcript, with a discrete divider row for each material
 * event. PURE (no react-native import) so this merge logic is
 * offline-testable under plain vitest/node, same discipline
 * `lib/materialIngestState.ts`'s module doc documents for this app's
 * non-UI logic.
 */
import type { MaterialEvent } from "./api/types";

/** The minimum shape a transcript turn needs to interleave — `app/study/[subjectId].tsx`'s own `TranscriptTurn` satisfies this structurally. */
export interface TimestampedTurn {
  id: string;
  timestamp: string;
}

export type TranscriptItem<T extends TimestampedTurn> =
  | { type: "turn"; turn: T }
  | { type: "materialEvent"; event: MaterialEvent };

export type ThreadItem<T extends TimestampedTurn> = TranscriptItem<T> | { type: "opening"; text: string };

/**
 * Opening is shown as a TutorMessage at the top of a topic thread —
 * always before turns and before the composer input.
 */
export function prependTutorOpening<T extends TimestampedTurn>(
  items: readonly TranscriptItem<T>[],
  openingText: string | null | undefined,
): ThreadItem<T>[] {
  const text = openingText?.trim();
  if (!text) return [...items];
  return [{ type: "opening", text }, ...items];
}

export function shouldRequestTutorOpening(input: {
  kind: "topic" | "milestone";
  topicId: string | null;
  exchangeCount: number;
  hasOpening: boolean;
}): boolean {
  return input.kind === "topic" && input.topicId !== null && input.exchangeCount === 0 && !input.hasOpening;
}

/**
 * Stable merge by ISO-8601 `timestamp` string (lexicographically ordorable
 * — same convention `@buxo/core/session`'s `newSessionId` docblock relies
 * on). Ties resolve turn-before-event: both source arrays are assumed
 * already chronological (server GET order for both `exchanges` and
 * `materialEvents`), and turns are listed first in the pre-sort array
 * below, so `Array.prototype.sort`'s guaranteed stability (ES2019+, both
 * V8/Node and Hermes) keeps that relative order at an exact-timestamp tie
 * — the common case being a session's INITIAL material (event timestamp ==
 * `session.createdAt`) with no turn at that exact instant, so ties are rare
 * in practice.
 */
export function interleaveMaterialEvents<T extends TimestampedTurn>(
  turns: readonly T[],
  events: readonly MaterialEvent[],
): TranscriptItem<T>[] {
  const items: TranscriptItem<T>[] = [
    ...turns.map((turn): TranscriptItem<T> => ({ type: "turn", turn })),
    ...events.map((event): TranscriptItem<T> => ({ type: "materialEvent", event })),
  ];
  return items
    .map((item, index) => ({ item, index, timestamp: item.type === "turn" ? item.turn.timestamp : item.event.timestamp }))
    .sort((a, b) => {
      if (a.timestamp < b.timestamp) return -1;
      if (a.timestamp > b.timestamp) return 1;
      return a.index - b.index;
    })
    .map((wrapped) => wrapped.item);
}
