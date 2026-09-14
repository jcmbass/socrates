import { describe, expect, it } from "vitest";
import {
  GUIDED_ITEM_TYPES,
  GuidedItemSchema,
  TopicItemsPayloadSchema,
  parseGuidedItem,
  parseTopicItemsPayload,
} from "../guided-item";

const elige = {
  id: "item-elige-1",
  type: "elige" as const,
  difficulty: 2 as const,
  prompt: "¿Cuál es la fórmula del agua?",
  options: ["H2O", "CO2", "NaCl", "O2"],
  answer: 0,
  explanation: "El agua es H₂O: dos hidrógenos y un oxígeno.",
};

const verdaderoFalso = {
  id: "item-vf-1",
  type: "verdadero_falso" as const,
  difficulty: 1 as const,
  prompt: "La luz viaja más rápido que el sonido.",
  options: ["Verdadero", "Falso"],
  answer: "Verdadero",
  explanation: "En el aire, la luz supera ampliamente la velocidad del sonido.",
};

const completa = {
  id: "item-comp-1",
  type: "completa" as const,
  difficulty: 3 as const,
  prompt: "La derivada de x² es ____.",
  options: ["2x", "x", "x²"],
  answer: 0,
  explanation: "d/dx(x²) = 2x.",
};

const expose = {
  id: "item-exp-1",
  type: "expose" as const,
  difficulty: 1 as const,
  prompt: "Un límite describe el valor al que se acerca una función.",
  options: [],
  answer: "",
  explanation: "Las tarjetas de exposición no se evalúan; preparan el tema.",
};
const payloadMeta = { grounding: "sources" as const, generatorVersion: "guided-items-v2" };

describe("GuidedItemSchema", () => {
  it("accepts all four item types", () => {
    for (const item of [elige, verdaderoFalso, completa, expose]) {
      expect(GuidedItemSchema.safeParse(item).success).toBe(true);
    }
    expect(GUIDED_ITEM_TYPES).toEqual(["elige", "verdadero_falso", "completa", "expose"]);
  });

  it("rejects invalid type or difficulty", () => {
    expect(GuidedItemSchema.safeParse({ ...elige, type: "quiz" }).success).toBe(false);
    expect(GuidedItemSchema.safeParse({ ...elige, difficulty: 4 }).success).toBe(false);
  });

  it("rejects empty prompt or explanation", () => {
    expect(GuidedItemSchema.safeParse({ ...elige, prompt: "" }).success).toBe(false);
    expect(GuidedItemSchema.safeParse({ ...elige, explanation: "" }).success).toBe(false);
  });

  it("accepts string or index answers", () => {
    expect(GuidedItemSchema.safeParse({ ...elige, answer: "H2O" }).success).toBe(true);
    expect(GuidedItemSchema.safeParse({ ...completa, answer: "2x" }).success).toBe(true);
  });
});

describe("TopicItemsPayloadSchema", () => {
  it("accepts a non-empty items array", () => {
    expect(TopicItemsPayloadSchema.safeParse({ items: [elige, expose], ...payloadMeta }).success).toBe(true);
  });

  it("rejects an empty items array", () => {
    expect(TopicItemsPayloadSchema.safeParse({ items: [], ...payloadMeta }).success).toBe(false);
  });

  it("requires grounding and generator provenance in cache schema v2", () => {
    expect(TopicItemsPayloadSchema.safeParse({ items: [elige] }).success).toBe(false);
    expect(TopicItemsPayloadSchema.safeParse({ items: [elige], grounding: "unknown", generatorVersion: "v1" }).success).toBe(false);
  });
});

describe("parse helpers", () => {
  it("parseGuidedItem returns a validated item", () => {
    expect(parseGuidedItem(elige)).toEqual(elige);
  });

  it("parseTopicItemsPayload returns a validated payload", () => {
    expect(parseTopicItemsPayload({ items: [completa], ...payloadMeta })).toEqual({ items: [completa], ...payloadMeta });
  });
});

describe("stripGuidedItemAnswer", () => {
  it("removes answer from client payloads", async () => {
    const { stripGuidedItemAnswer, stripGuidedItemAnswers } = await import("../guided-item");
    expect(stripGuidedItemAnswer(elige)).toEqual({
      id: elige.id,
      type: elige.type,
      difficulty: elige.difficulty,
      prompt: elige.prompt,
      options: elige.options,
      explanation: elige.explanation,
    });
    expect(stripGuidedItemAnswers([elige, expose])).toHaveLength(2);
    expect(stripGuidedItemAnswers([elige, expose]).every((i) => !("answer" in i))).toBe(true);
  });
});
