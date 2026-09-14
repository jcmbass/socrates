import { describe, expect, it } from "vitest";
import { BandChangeSchema, MaterialEventSchema, StudySessionSchema, type StudySession } from "../study-session";

function makeStudySession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "20260710T100000000Z-aaaaaaaa",
    userId: "user-1",
    subjectId: "subject-1",
    subjectNameSnapshot: "Cálculo I",
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    status: "active",
    kind: "topic",
    topicId: null,
    milestoneId: null,
    previousSessionId: null,
    initialBand: "guiding",
    materialAssetIds: ["material-1"],
    materialSnapshotTextRef: "sha256:abcd",
    materialSnapshotInfo: { truncated: false, droppedTokens: 0 },
    bandChanges: [{ band: "guiding", timestamp: "2026-07-10T10:00:00.000Z", source: "initial", rationale: null }],
    materialEvents: [
      { timestamp: "2026-07-10T10:00:00.000Z", materialAssetId: "material-1", source: "guia.pdf", kind: "pdf", action: "added" },
    ],
    schemaVersion: 1,
    ...overrides,
  };
}

describe("StudySessionSchema", () => {
  it("accepts a well-formed active StudySession", () => {
    expect(StudySessionSchema.safeParse(makeStudySession()).success).toBe(true);
  });

  it("accepts a session with no material grounding", () => {
    const result = StudySessionSchema.safeParse(
      makeStudySession({ materialAssetIds: [], materialSnapshotTextRef: null, materialSnapshotInfo: null, materialEvents: [] }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(StudySessionSchema.safeParse(makeStudySession({ status: "paused" as never })).success).toBe(false);
  });

  it("rejects an invalid Band", () => {
    expect(StudySessionSchema.safeParse(makeStudySession({ initialBand: "strict" as never })).success).toBe(false);
  });

  it("accepts a topic session with a topicId", () => {
    const result = StudySessionSchema.safeParse(makeStudySession({ kind: "topic", topicId: "topic-1" }));
    expect(result.success).toBe(true);
  });

  it("accepts a milestone session with a milestoneId and no topicId", () => {
    const result = StudySessionSchema.safeParse(makeStudySession({ kind: "milestone", topicId: null, milestoneId: "milestone-1" }));
    expect(result.success).toBe(true);
  });

  it("rejects an invalid kind", () => {
    expect(StudySessionSchema.safeParse(makeStudySession({ kind: "exam" as never })).success).toBe(false);
  });
});

describe("BandChangeSchema", () => {
  it("accepts a null rationale (auto/system changes without a logged reason)", () => {
    const result = BandChangeSchema.safeParse({
      band: "probing",
      timestamp: "2026-07-10T10:00:00.000Z",
      source: "manual",
      rationale: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown source", () => {
    const result = BandChangeSchema.safeParse({
      band: "probing",
      timestamp: "2026-07-10T10:00:00.000Z",
      source: "scheduled" as never,
      rationale: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("MaterialEventSchema", () => {
  it("accepts a well-formed 'added' event", () => {
    const result = MaterialEventSchema.safeParse({
      timestamp: "2026-07-10T10:00:00.000Z",
      materialAssetId: "material-1",
      source: "guia.pdf",
      kind: "pdf",
      action: "added",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the legal-but-unproduced 'removed' action", () => {
    const result = MaterialEventSchema.safeParse({
      timestamp: "2026-07-10T10:00:00.000Z",
      materialAssetId: "material-1",
      source: "guia.pdf",
      kind: "pdf",
      action: "removed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const result = MaterialEventSchema.safeParse({
      timestamp: "2026-07-10T10:00:00.000Z",
      materialAssetId: "material-1",
      source: "foto.jpg",
      kind: "photo" as never,
      action: "added",
    });
    expect(result.success).toBe(false);
  });
});
