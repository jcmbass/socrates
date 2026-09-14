import type { Band } from "./prompts";

/**
 * Pure transcript types shared across the harness and (eventually) other
 * consumers of the tutoring core. Split out of `apps/harness/lib/
 * transcript.ts` in F1 WP1.1 (2026-07-14): that file's `SessionTranscript`/
 * `buildTranscript`/`serializeTranscript`/`downloadTranscript` stay in
 * apps/harness because `downloadTranscript` touches DOM globals (`Blob`,
 * `URL`, `document`) and this package's tsconfig has `lib: ["ES2023"]`
 * with no `"dom"` (the mechanical purity gate, G1) — `tsc --noEmit` would
 * reject the whole file (TS2584) if those DOM references lived here too.
 * `Exchange`/`MaterialEvent`/`MaterialInfo` themselves are plain data
 * shapes with zero DOM/I/O dependency, so they move; apps/harness/lib/
 * transcript.ts now imports (and re-exports) them from here instead of
 * defining them locally.
 */

export interface Exchange {
  studentMessage: string;
  tutorReply: string;
  band: Band;
  timestamp: string;
  /** Judge flags for this exchange, or null on judge failure (never blocks the chat). */
  hintOffered: boolean | null;
  studentCorrect: boolean | null;
}

export interface MaterialInfo {
  truncated: boolean;
  droppedTokens: number;
}

export interface MaterialEvent {
  timestamp: string;
  source: string;
  kind: "paste" | "txt" | "pdf";
  action: "added" | "removed";
}
