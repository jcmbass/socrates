#!/usr/bin/env node
/**
 * SPIKE F0.5 — reassembles a `SpikeResult` JSON dump from raw `adb logcat`
 * output (the chunked `F05_SPIKE_RESULT i/total <fragment>` lines written
 * by `app/dev/spike-f05.tsx`'s `dumpResultToLogcat`, per
 * `lib/spikeF05Bridge.ts`'s `chunkForLogcat`/`LOGCAT_MARKER`).
 *
 * Usage (Phase 2 evidence-gathering, per the architect's run instructions):
 *   adb logcat -d > /tmp/f05-logcat-raw.txt
 *   node spike-f05/reassemble-logcat.mjs /tmp/f05-logcat-raw.txt > result.json
 *
 * Then feed result.json's `.materialText` (after extracting it, e.g. with
 * `node -e "console.log(JSON.parse(require('fs').readFileSync('result.json','utf8')).materialText)" > extracted.txt`)
 * into `fidelity.mjs` alongside `docs/guia1.txt`.
 *
 * Tolerant of interleaved, out-of-order, or duplicated logcat lines (Metro
 * + RN + other app chatter share the same log stream) — chunks are sorted
 * by their declared index before concatenation, not by file order.
 */
import { readFileSync } from "node:fs";

const LOGCAT_MARKER = "F05_SPIKE_RESULT";
// Matches "... F05_SPIKE_RESULT 3/12 <fragment>" regardless of whatever
// logcat prefix (timestamp, pid, tag) precedes it.
const CHUNK_LINE = new RegExp(`${LOGCAT_MARKER} (\\d+)/(\\d+) (.*)$`);

export function reassembleFromLogcatText(logcatText) {
  const chunksByIndex = new Map();
  let declaredTotal = null;

  for (const line of logcatText.split("\n")) {
    const m = line.match(CHUNK_LINE);
    if (!m) continue;
    const idx = Number(m[1]);
    const total = Number(m[2]);
    const fragment = m[3];
    declaredTotal = total;
    // Later duplicate of the same index overwrites — logcat can repeat
    // lines across buffer dumps; both dumps should be byte-identical for
    // the same run, so last-write-wins is safe.
    chunksByIndex.set(idx, fragment);
  }

  if (declaredTotal === null) {
    throw new Error(`No "${LOGCAT_MARKER} i/total ..." lines found in input.`);
  }

  const missing = [];
  let payload = "";
  for (let i = 1; i <= declaredTotal; i++) {
    const fragment = chunksByIndex.get(i);
    if (fragment === undefined) {
      missing.push(i);
      continue;
    }
    payload += fragment;
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing chunk(s) ${missing.join(", ")} of ${declaredTotal} — logcat buffer likely rotated mid-run. Re-run with a larger -b/-t buffer or capture sooner after the run completes.`,
    );
  }

  return payload;
}

function main() {
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    console.error("Usage: node spike-f05/reassemble-logcat.mjs <adb-logcat-dump.txt>");
    process.exit(2);
  }
  const text = readFileSync(inputPath, "utf8");
  const payload = reassembleFromLogcatText(text);
  // Validate it's actually parseable JSON before handing it back — fail
  // loud here rather than downstream in fidelity.mjs with a confusing
  // JSON.parse error.
  JSON.parse(payload);
  console.log(payload);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
