import { test } from "node:test";
import assert from "node:assert/strict";
import { reassembleFromLogcatText } from "../reassemble-logcat.mjs";
import { chunkForLogcat } from "../../lib/spikeF05Bridge.ts";

test("reassembleFromLogcatText: round-trips a payload chunked by chunkForLogcat, with realistic logcat noise around it", () => {
  const payload = JSON.stringify({ fileName: "guia1.pdf", totalElapsedMs: 4321, routes: [{ page: 1, total: 3, routeKind: "local-text" }] });
  const chunks = chunkForLogcat(payload);
  const logcatLines = [
    "07-16 08:00:00.000  1234  1234 I ReactNativeJS: Running application on device",
    ...chunks.map((c) => `07-16 08:00:01.000  1234  1234 I ReactNativeJS: ${c}`),
    "07-16 08:00:02.000  1234  1234 I ReactNativeJS: some unrelated log line",
  ];
  const reassembled = reassembleFromLogcatText(logcatLines.join("\n"));
  assert.equal(reassembled, payload);
  assert.deepEqual(JSON.parse(reassembled), JSON.parse(payload));
});

test("reassembleFromLogcatText: tolerates duplicated/out-of-order chunk lines", () => {
  const payload = "x".repeat(7000);
  const chunks = chunkForLogcat(payload);
  const shuffled = [...chunks].reverse();
  const withDuplicate = [...shuffled, chunks[0]]; // duplicate first chunk at the end
  const reassembled = reassembleFromLogcatText(withDuplicate.join("\n"));
  assert.equal(reassembled, payload);
});

test("reassembleFromLogcatText: throws a clear error when a chunk is missing", () => {
  const payload = "y".repeat(7000);
  const chunks = chunkForLogcat(payload);
  const withGap = chunks.filter((_, i) => i !== 1); // drop the second chunk
  assert.throws(() => reassembleFromLogcatText(withGap.join("\n")), /Missing chunk/);
});

test("reassembleFromLogcatText: throws when no marker lines are present at all", () => {
  assert.throws(() => reassembleFromLogcatText("nothing interesting here"), /No .*lines found/);
});
