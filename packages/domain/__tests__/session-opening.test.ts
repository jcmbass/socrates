import { describe, expect, it } from "vitest";
import { parseSessionOpeningGrounding, SessionOpeningSchema, type SessionOpening } from "../session-opening";

function makeOpening(overrides: Partial<SessionOpening> = {}): SessionOpening {
  return {
    id: "opening-1",
    sessionId: "session-1",
    userId: "user-1",
    text: "Una idea breve: la pendiente es el cambio. ¿Qué pasa si duplicás el incremento en x?",
    tutorPromptVersion: "buxo-socratic-v3",
    tutorModelId: "claude-sonnet-5",
    tutorProviderId: "anthropic",
    grounding: "fuentes",
    createdAt: "2026-09-07T12:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("SessionOpeningSchema", () => {
  it("accepts a well-formed opening grounded in Fuentes", () => {
    expect(SessionOpeningSchema.safeParse(makeOpening()).success).toBe(true);
  });

  it("accepts general grounding when there is no Fuente corpus", () => {
    expect(SessionOpeningSchema.safeParse(makeOpening({ grounding: "general" })).success).toBe(true);
  });

  it("rejects an empty tutor text", () => {
    expect(SessionOpeningSchema.safeParse(makeOpening({ text: "" })).success).toBe(false);
  });

  it("rejects an unknown grounding", () => {
    expect(SessionOpeningSchema.safeParse(makeOpening({ grounding: "invented" as never })).success).toBe(false);
  });
});

describe("parseSessionOpeningGrounding", () => {
  it("accepts the two declared values and rejects anything else", () => {
    expect(parseSessionOpeningGrounding("fuentes")).toBe("fuentes");
    expect(parseSessionOpeningGrounding("general")).toBe("general");
    expect(parseSessionOpeningGrounding("invented")).toBeNull();
    expect(parseSessionOpeningGrounding(null)).toBeNull();
  });
});
