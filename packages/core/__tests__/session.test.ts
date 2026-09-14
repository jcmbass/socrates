import { describe, expect, it } from "vitest";
import {
  InvalidSessionError,
  deserializeSession,
  emptySession,
  newSessionId,
  parseSession,
  serializeSession,
  summarize,
  type Session,
} from "../session";
import { PROMPT_VERSION } from "@buxo/core/prompts";

describe("newSessionId", () => {
  it("matches <compact-ISO>-<8 hex chars>, with no filesystem-unsafe characters", () => {
    const id = newSessionId(new Date("2026-07-10T21:15:00.123Z"));
    expect(id).toMatch(/^20260710T211500123Z-[0-9a-f]{8}$/);
    expect(id).not.toMatch(/[:./\\]/);
  });

  it("is unique across calls at the same instant", () => {
    const now = new Date("2026-07-10T21:15:00.000Z");
    const a = newSessionId(now);
    const b = newSessionId(now);
    expect(a).not.toBe(b);
  });

  it("sorts lexicographically in creation-time order", () => {
    const earlier = newSessionId(new Date("2026-07-10T10:00:00.000Z"));
    const later = newSessionId(new Date("2026-07-10T11:00:00.000Z"));
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    ...emptySession({
      subject: "Calculus I",
      initialBand: "guiding",
      now: new Date("2026-07-10T10:00:00.000Z"),
      id: "20260710T100000000Z-aaaaaaaa",
    }),
    ...overrides,
  };
}

describe("emptySession", () => {
  it("builds a fresh session with a seeded initial band change and empty history", () => {
    const s = emptySession({ subject: "Biología", initialBand: "probing" });
    expect(s.subject).toBe("Biología");
    expect(s.initialBand).toBe("probing");
    expect(s.messages).toEqual([]);
    expect(s.exchanges).toEqual([]);
    expect(s.assessments).toEqual([]);
    expect(s.material).toBeNull();
    expect(s.materialEvents).toEqual([]);
    expect(s.materialText).toBe("");
    expect(s.promptVersion).toBe(PROMPT_VERSION);
    expect(s.createdAt).toBe(s.updatedAt);
    expect(s.bandChanges).toEqual([
      { band: "probing", timestamp: s.createdAt, source: "initial" },
    ]);
    expect(s.id).toMatch(/^\d{8}T\d{9}Z-[0-9a-f]{8}$/);
  });

  it("accepts an injected id and clock for determinism", () => {
    const s = emptySession({
      subject: "Calculus I",
      initialBand: "guiding",
      id: "fixed-id",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(s.id).toBe("fixed-id");
    expect(s.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("summarize", () => {
  it("projects a Session down to its list-row shape", () => {
    const s = makeSession({
      exchanges: [
        {
          studentMessage: "hi",
          tutorReply: "what do you think?",
          band: "guiding",
          timestamp: "2026-07-10T10:01:00.000Z",
          hintOffered: null,
          studentCorrect: null,
        },
      ],
      updatedAt: "2026-07-10T10:01:00.000Z",
    });
    expect(summarize(s)).toEqual({
      id: s.id,
      subject: s.subject,
      createdAt: s.createdAt,
      updatedAt: "2026-07-10T10:01:00.000Z",
      exchangeCount: 1,
    });
  });
});

describe("serializeSession / deserializeSession", () => {
  it("round-trips a full session with every sub-shape populated", () => {
    const s = makeSession({
      messages: [{ role: "user", content: "hola", timestamp: "2026-07-10T10:01:00.000Z" }],
      exchanges: [
        {
          studentMessage: "Is the derivative of x^2 equal to x?",
          tutorReply: "What rule have we used for powers of x before?",
          band: "guiding",
          timestamp: "2026-07-10T10:01:00.000Z",
          hintOffered: true,
          studentCorrect: false,
        },
      ],
      bandChanges: [
        { band: "guiding", timestamp: "2026-07-10T10:00:00.000Z", source: "initial" },
        {
          band: "probing",
          timestamp: "2026-07-10T10:05:00.000Z",
          source: "auto",
          rationale: "student explained the power rule unprompted",
        },
      ],
      assessments: [
        {
          exchangeIndex: 0,
          timestamp: "2026-07-10T10:01:00.000Z",
          demonstratedUnderstanding: "developing",
          explainedInOwnWords: true,
          guessedOrPatternMatched: false,
          recommendedBand: "probing",
          rationale: "explained the rule, not just the answer",
        },
      ],
      material: { truncated: true, droppedTokens: 120 },
      materialEvents: [
        {
          timestamp: "2026-07-10T09:59:00.000Z",
          source: "chapter3.pdf",
          kind: "pdf",
          action: "added",
        },
      ],
      materialText: "# Chapter 3\n\nDerivatives...",
    });

    const roundTripped = deserializeSession(serializeSession(s));
    expect(roundTripped).toEqual(s);
  });

  it("round-trips the minimal empty session", () => {
    const s = makeSession();
    expect(deserializeSession(serializeSession(s))).toEqual(s);
  });

  it("rejects invalid JSON", () => {
    expect(() => deserializeSession("{not json")).toThrow(InvalidSessionError);
  });

  it("rejects a JSON value that isn't an object", () => {
    expect(() => deserializeSession("42")).toThrow(InvalidSessionError);
    expect(() => deserializeSession("null")).toThrow(InvalidSessionError);
    expect(() => deserializeSession("[]")).toThrow(InvalidSessionError);
  });

  it("rejects a session missing a required field", () => {
    const s = makeSession();
    const raw = JSON.parse(serializeSession(s)) as Record<string, unknown>;
    delete raw.id;
    expect(() => parseSession(raw)).toThrow(/id/);
  });

  it("rejects an invalid band", () => {
    const raw = JSON.parse(serializeSession(makeSession()));
    raw.initialBand = "aggressive";
    expect(() => parseSession(raw)).toThrow(/initialBand/);
  });

  it("rejects a bandChange with an invalid source", () => {
    const raw = JSON.parse(serializeSession(makeSession()));
    raw.bandChanges[0].source = "founder-vibes";
    expect(() => parseSession(raw)).toThrow(/bandChanges\[0\]\.source/);
  });

  it("rejects an assessment with an invalid demonstratedUnderstanding", () => {
    const s = makeSession({
      assessments: [
        {
          exchangeIndex: 0,
          timestamp: "2026-07-10T10:01:00.000Z",
          demonstratedUnderstanding: "solid",
          explainedInOwnWords: true,
          guessedOrPatternMatched: false,
          recommendedBand: "minimal",
          rationale: "clean explanation",
        },
      ],
    });
    const raw = JSON.parse(serializeSession(s));
    raw.assessments[0].demonstratedUnderstanding = "mastery";
    expect(() => parseSession(raw)).toThrow(/demonstratedUnderstanding/);
  });

  it("rejects a non-array exchanges field", () => {
    const raw = JSON.parse(serializeSession(makeSession()));
    raw.exchanges = "oops";
    expect(() => parseSession(raw)).toThrow(/exchanges/);
  });

  it("rejects an exchange with a malformed hintOffered", () => {
    const raw = JSON.parse(serializeSession(makeSession()));
    raw.exchanges = [
      {
        studentMessage: "x",
        tutorReply: "y",
        band: "guiding",
        timestamp: "2026-07-10T10:01:00.000Z",
        hintOffered: "yes",
        studentCorrect: null,
      },
    ];
    expect(() => parseSession(raw)).toThrow(/hintOffered/);
  });
});
