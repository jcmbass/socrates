/**
 * Verifies the ingest transcription seam is provider-agnostic: a fake
 * `createIngestAdapter` can be swapped in without touching pipeline.ts.
 */
import { describe, expect, it } from "vitest";
import { transcribePage } from "../../src/models/ingest";
import type { IngestAdapter } from "@buxo/models/execution/ingest";
import type { ModelDeps } from "../../src/models/adapters";

function fakeIngestAdapter(text: string): IngestAdapter {
  return {
    transcribeImage: async () => ({ text, servedBy: { providerId: "fake", modelId: "vision-ocr" }, promptVersion: "fake-v1" }),
  };
}

describe("transcribePage — provider-agnostic adapter seam", () => {
  it("dispatches to the injected IngestAdapter and returns its text", async () => {
    const modelDeps: Pick<ModelDeps, "createIngestAdapter"> = {
      createIngestAdapter: () => fakeIngestAdapter("fake transcription"),
    };

    const outcome = await transcribePage(modelDeps, { pngBytes: new Uint8Array([1, 2, 3]) });
    expect(outcome.text).toBe("fake transcription");
    expect(outcome.servedBy).toEqual({ providerId: "fake", modelId: "vision-ocr" });
    expect(outcome.costUsd).toBeNull();
  });
});
