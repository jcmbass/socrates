import { describe, expect, it } from "vitest";
import { interleaveMaterialEvents, prependTutorOpening, shouldRequestTutorOpening, type TimestampedTurn } from "../transcriptEvents";
import type { MaterialEvent } from "../api/types";

function turn(id: string, timestamp: string): TimestampedTurn {
  return { id, timestamp };
}

function event(materialAssetId: string, timestamp: string, overrides: Partial<MaterialEvent> = {}): MaterialEvent {
  return { timestamp, materialAssetId, source: `${materialAssetId}.pdf`, kind: "pdf", action: "added", ...overrides };
}

describe("interleaveMaterialEvents — F2 WQ3 parte C2", () => {
  it("returns turns unchanged when there are no material events", () => {
    const turns = [turn("t1", "2026-07-17T10:00:00.000Z"), turn("t2", "2026-07-17T10:05:00.000Z")];
    const result = interleaveMaterialEvents(turns, []);
    expect(result).toEqual([{ type: "turn", turn: turns[0] }, { type: "turn", turn: turns[1] }]);
  });

  it("returns material events unchanged when there are no turns", () => {
    const events = [event("m1", "2026-07-17T10:00:00.000Z")];
    const result = interleaveMaterialEvents([], events);
    expect(result).toEqual([{ type: "materialEvent", event: events[0] }]);
  });

  it("interleaves a material event BETWEEN two turns by timestamp", () => {
    const t1 = turn("t1", "2026-07-17T10:00:00.000Z");
    const t2 = turn("t2", "2026-07-17T10:10:00.000Z");
    const e1 = event("m1", "2026-07-17T10:05:00.000Z");

    const result = interleaveMaterialEvents([t1, t2], [e1]);
    expect(result).toEqual([
      { type: "turn", turn: t1 },
      { type: "materialEvent", event: e1 },
      { type: "turn", turn: t2 },
    ]);
  });

  it("places an initial-material event (session creation timestamp) BEFORE the first turn", () => {
    const e1 = event("m1", "2026-07-17T09:00:00.000Z");
    const t1 = turn("t1", "2026-07-17T09:01:00.000Z");

    const result = interleaveMaterialEvents([t1], [e1]);
    expect(result).toEqual([
      { type: "materialEvent", event: e1 },
      { type: "turn", turn: t1 },
    ]);
  });

  it("places a mid-session attach event AFTER the last turn when it happens after every turn so far", () => {
    const t1 = turn("t1", "2026-07-17T09:00:00.000Z");
    const e1 = event("m1", "2026-07-17T09:30:00.000Z");

    const result = interleaveMaterialEvents([t1], [e1]);
    expect(result).toEqual([
      { type: "turn", turn: t1 },
      { type: "materialEvent", event: e1 },
    ]);
  });

  it("handles multiple material events and multiple turns, fully sorted", () => {
    const t1 = turn("t1", "2026-07-17T09:00:00.000Z");
    const t2 = turn("t2", "2026-07-17T09:20:00.000Z");
    const e1 = event("m1", "2026-07-17T08:59:00.000Z"); // initial material, before any turn
    const e2 = event("m2", "2026-07-17T09:10:00.000Z"); // mid-session attach, between t1 and t2

    const result = interleaveMaterialEvents([t1, t2], [e1, e2]);
    expect(result.map((i) => (i.type === "turn" ? `turn:${i.turn.id}` : `event:${i.event.materialAssetId}`))).toEqual([
      "event:m1",
      "turn:t1",
      "event:m2",
      "turn:t2",
    ]);
  });

  it("breaks an exact-timestamp tie turn-before-event (stable sort)", () => {
    const t1 = turn("t1", "2026-07-17T10:00:00.000Z");
    const e1 = event("m1", "2026-07-17T10:00:00.000Z");

    const result = interleaveMaterialEvents([t1], [e1]);
    expect(result).toEqual([
      { type: "turn", turn: t1 },
      { type: "materialEvent", event: e1 },
    ]);
  });
});

describe("prependTutorOpening + shouldRequestTutorOpening", () => {
  it("places the opening before turns so it renders above the composer input", () => {
    const t1 = turn("t1", "2026-09-07T10:00:00.000Z");
    const items = interleaveMaterialEvents([t1], []);
    const thread = prependTutorOpening(items, "¿Qué pasa si duplicás el incremento?");
    expect(thread[0]).toEqual({ type: "opening", text: "¿Qué pasa si duplicás el incremento?" });
    expect(thread[1]).toEqual({ type: "turn", turn: t1 });
  });

  it("omits a missing/blank opening so the empty-state path can still show", () => {
    expect(prependTutorOpening([], null)).toEqual([]);
    expect(prependTutorOpening([], "   ")).toEqual([]);
  });

  it("requests opening only for an empty topic-scoped session without one yet", () => {
    expect(
      shouldRequestTutorOpening({ kind: "topic", topicId: "t1", exchangeCount: 0, hasOpening: false }),
    ).toBe(true);
    expect(
      shouldRequestTutorOpening({ kind: "topic", topicId: "t1", exchangeCount: 0, hasOpening: true }),
    ).toBe(false);
    expect(
      shouldRequestTutorOpening({ kind: "topic", topicId: "t1", exchangeCount: 1, hasOpening: false }),
    ).toBe(false);
    expect(
      shouldRequestTutorOpening({ kind: "milestone", topicId: null, exchangeCount: 0, hasOpening: false }),
    ).toBe(false);
    expect(
      shouldRequestTutorOpening({ kind: "topic", topicId: null, exchangeCount: 0, hasOpening: false }),
    ).toBe(false);
  });
});
