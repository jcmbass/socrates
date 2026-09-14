import { describe, expect, it, vi } from "vitest";
import { GeneratedGuidedBatchSchema, GeneratedItemSchema, GUIDED_ITEMS_CALL_TIMEOUT_MS, GUIDED_ITEMS_MAX_OUTPUT_TOKENS, GUIDED_ITEMS_SYSTEM_PROMPT, GENERATED_ITEM_MAX_PROMPT_CHARS, generateTopicItems } from "../../src/guided/generate-topic-items";
import { GUIDED_ITEMS_GENERATOR_VERSION, TopicItemsPayloadSchema } from "@buxo/domain/guided-item";
import type { StructuredAdapter, StructuredCallParams } from "@buxo/models/execution/structured";

const generated = {
  items: [
    { type: "expose", difficulty: 1, prompt: "Un límite describe el valor al que se aproxima una función.", options: [], answer: "", explanation: "La aproximación puede existir aunque el valor puntual sea distinto." },
    { type: "expose", difficulty: 1, prompt: "La continuidad exige que límite y valor de la función coincidan.", options: [], answer: "", explanation: "Las tres condiciones de continuidad deben cumplirse en el punto." },
    { type: "elige", difficulty: 1, prompt: "¿Qué compara la continuidad en un punto?", options: ["Pendiente y área", "Límite y valor", "Dominio y rango", "Máximo y mínimo"], answer: 1, explanation: "Una función es continua cuando el límite existe y coincide con su valor." },
    { type: "verdadero_falso", difficulty: 1, prompt: "Una función puede tener límite aunque no esté definida en el punto.", options: ["Verdadero", "Falso"], answer: "Verdadero", explanation: "El límite depende del comportamiento cercano, no necesariamente del valor puntual." },
    { type: "completa", difficulty: 2, prompt: "Si lim f(x)=3 y f(a)=3, una condición de continuidad ____.", options: ["se incumple", "se cumple", "no puede evaluarse"], answer: 1, explanation: "La igualdad entre límite y valor satisface una de las condiciones." },
    { type: "elige", difficulty: 2, prompt: "¿Cuál situación muestra una discontinuidad removible?", options: ["Un hueco con límite finito", "Una asíntota vertical", "Oscilación infinita", "Una recta continua"], answer: 0, explanation: "El hueco puede corregirse definiendo el valor como el límite finito." },
    { type: "verdadero_falso", difficulty: 2, prompt: "Una asíntota vertical implica un límite finito.", options: ["Verdadero", "Falso"], answer: "Falso", explanation: "Cerca de una asíntota vertical los valores crecen sin cota." },
    { type: "completa", difficulty: 3, prompt: "Para reparar un hueco en x=a se define f(a) como ____.", options: ["cero siempre", "la derivada", "el límite"], answer: 2, explanation: "Asignar el límite existente hace coincidir límite y valor." },
  ],
} as const;

function adapterReturning(object: unknown = generated): StructuredAdapter {
  return {
    generateStructured: vi.fn(async (_params: StructuredCallParams<unknown>) => ({
      ok: true as const,
      object,
      servedBy: { providerId: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4-Flash-0731" },
      promptVersion: GUIDED_ITEMS_GENERATOR_VERSION,
      costUsd: 0.001,
    })) as StructuredAdapter["generateStructured"],
  };
}

describe("generateTopicItems", () => {
  it("returns validated v2 content with deterministic server ids", async () => {
    const structuredAdapter = adapterReturning();
    const a = await generateTopicItems({ title: "Límites y continuidad", structuredAdapter });
    const b = await generateTopicItems({ title: "Límites y continuidad", structuredAdapter });
    expect(a.payload).toEqual(b.payload);
    expect(a).toMatchObject({ costUsd: 0.001 });
    expect(a.payload).toMatchObject({ grounding: "general", generatorVersion: GUIDED_ITEMS_GENERATOR_VERSION });
    expect(GUIDED_ITEMS_GENERATOR_VERSION).toBe("guided-items-v3");
    expect(GUIDED_ITEMS_MAX_OUTPUT_TOKENS).toBe(1800);
    expect(GUIDED_ITEMS_CALL_TIMEOUT_MS).toBe(75_000);
    expect(TopicItemsPayloadSchema.safeParse(a.payload).success).toBe(true);
    expect(a.payload.items.map((item) => item.answer)).toEqual(["", "", 1, "Verdadero", 1, 0, "Falso", 2]);
  });

  it("passes title, unitLabel and labeled Fuentes context to guided-items", async () => {
    const structuredAdapter = adapterReturning();
    const result = await generateTopicItems({
      title: "Límites",
      unitLabel: "Unidad 3",
      sourcesText: "### Guía.pdf\nEl límite vale 3.",
      structuredAdapter,
    });
    expect(result.payload.grounding).toBe("sources");
    const call = vi.mocked(structuredAdapter.generateStructured).mock.calls[0]![0];
    expect(call.task).toBe("guided-items");
    expect(call.prompt).toContain("Tema: Límites");
    expect(call.prompt).toContain("Unidad: Unidad 3");
    expect(call.prompt).toContain("### Guía.pdf");
    expect(call.schema).toBe(GeneratedGuidedBatchSchema);
    expect(call.maxOutputTokens).toBe(GUIDED_ITEMS_MAX_OUTPUT_TOKENS);
    expect(call.timeoutMs).toBe(GUIDED_ITEMS_CALL_TIMEOUT_MS);
  });

  it("prompt forbids tautologies/meta questions and requires useful explanations", () => {
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/meta|tautológicas/i);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/comprensión y aplicación/i);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/explicación.*justificar/i);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/Varía la posición/i);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/exactamente 8/);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/2 exposiciones breves/);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/2-3 frases/);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/concisas/);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/texto exacto/);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/pertenencia|relevancia/i);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/no se estudia/i);
    expect(GUIDED_ITEMS_SYSTEM_PROMPT).toMatch(/relaci[oó]n con esta unidad/i);
  });

  it("rejects malformed, tautological, and incomplete batches before they reach the cache", () => {
    expect(GeneratedGuidedBatchSchema.safeParse({ items: generated.items.slice(0, 3) }).success).toBe(false);
    const duplicate = { items: generated.items.map((item, i) => i === 7 ? { ...item, prompt: generated.items[6].prompt } : item) };
    expect(GeneratedGuidedBatchSchema.safeParse(duplicate).success).toBe(false);

    const tautology = {
      items: generated.items.map((item, i) =>
        i === 2 ? { ...item, prompt: "¿Cuál opción describe mejor el foco de estudio?" } : item,
      ),
    };
    expect(GeneratedGuidedBatchSchema.safeParse(tautology).success).toBe(false);

    const noMix = { items: generated.items.map((item) => item.type === "completa" ? { ...generated.items[2], prompt: `${item.prompt} extra` } : item) };
    expect(GeneratedGuidedBatchSchema.safeParse(noMix).success).toBe(false);

    const repetitive = {
      items: generated.items.map((item, i) =>
        i === 2 ? { ...item, explanation: "Límite y valor" } : item,
      ),
    };
    expect(GeneratedGuidedBatchSchema.safeParse(repetitive).success).toBe(false);

    const reusedExplanation = {
      items: generated.items.map((item, i) =>
        i === 1 ? { ...item, explanation: generated.items[0]!.explanation } : item,
      ),
    };
    expect(GeneratedGuidedBatchSchema.safeParse(reusedExplanation).success).toBe(false);

    const badVf = {
      items: generated.items.map((item, i) =>
        i === 3 ? { ...item, options: ["True", "False"], answer: "True" } : item,
      ),
    };
    expect(GeneratedGuidedBatchSchema.safeParse(badVf).success).toBe(false);

    const vfIndex = {
      items: generated.items.map((item, i) =>
        i === 3 ? { ...item, answer: 0 } : item,
      ),
    };
    expect(GeneratedGuidedBatchSchema.safeParse(vfIndex).success).toBe(false);

    const nine = {
      items: [
        ...generated.items,
        {
          ...generated.items[2],
          prompt: "¿Qué otra comparación hace la continuidad en un entorno?",
          explanation: "Otra justificación distinta del límite y el valor puntual.",
        },
      ],
    };
    expect(GeneratedGuidedBatchSchema.safeParse(nine).success).toBe(false);

    const threeExpose = {
      items: generated.items.map((item, i) =>
        i === 2 ? { ...generated.items[0], prompt: "Una tercera idea concreta del límite lateral." } : item,
      ),
    };
    expect(GeneratedGuidedBatchSchema.safeParse(threeExpose).success).toBe(false);

    const tooLong = {
      items: generated.items.map((item, i) =>
        i === 0 ? { ...item, prompt: "Idea concreta. ".repeat(80).slice(0, GENERATED_ITEM_MAX_PROMPT_CHARS + 1) } : item,
      ),
    };
    expect(GeneratedGuidedBatchSchema.safeParse(tooLong).success).toBe(false);
  });

  it("rejects curriculum membership/relevance prompts, including the real biology sample", () => {
    const vf = (prompt: string) => ({
      type: "verdadero_falso" as const,
      difficulty: 2 as const,
      prompt,
      options: ["Verdadero", "Falso"],
      answer: "Falso" as const,
      explanation: "Justificación con un mecanismo o definición, no con el temario.",
    });
    const rejected = [
      "La diversidad de los seres vivos es un tema que no se estudia en biología.",
      "La fotosíntesis no tiene relación con esta unidad.",
      "La mitosis no pertenece a esta materia.",
      "El ADN no es relevante para este tema.",
      "La cinemática no forma parte de esta unidad.",
      "Este contenido no se enseña en esta asignatura.",
      "La evolución no está relacionada con esta materia.",
      "¿Se estudia la célula en esta unidad?",
      "La química no tiene nada que ver con este temario.",
    ];
    for (const prompt of rejected) {
      expect(GeneratedItemSchema.safeParse(vf(prompt)).success, prompt).toBe(false);
    }
    const membershipBatch = {
      items: generated.items.map((item, i) => (i === 3 ? vf(rejected[0]!) : item)),
    };
    expect(GeneratedGuidedBatchSchema.safeParse(membershipBatch).success).toBe(false);
  });

  it("accepts conceptual prompts from real biology/physics samples and relation-between-ideas", () => {
    const vf = (prompt: string, answer: "Verdadero" | "Falso" = "Falso") => ({
      type: "verdadero_falso" as const,
      difficulty: 1 as const,
      prompt,
      options: ["Verdadero", "Falso"],
      answer,
      explanation: "Justificación con un mecanismo o definición concreta del fenómeno.",
    });
    const accepted = [
      vf("La homeostasis solo ocurre en animales de sangre caliente."),
      vf("La física moderna incluye la relatividad especial, pero no la mecánica cuántica."),
      vf("La relatividad general se aplica a fenómenos con velocidades cercanas a la de la luz o campos gravitatorios intensos.", "Verdadero"),
      vf("La masa no tiene relación con la aceleración de la gravedad en caída libre."),
      vf("El estudiante registra el cambio de posición en esta unidad de tiempo."),
      {
        type: "elige" as const,
        difficulty: 2 as const,
        prompt: "¿Cuál de los siguientes niveles de organización biológica incluye a todos los demás?",
        options: ["Célula", "Tejido", "Ecosistema", "Organismo"],
        answer: 2,
        explanation: "El ecosistema incluye organismos, poblaciones y comunidades con su ambiente.",
      },
      {
        type: "elige" as const,
        difficulty: 1 as const,
        prompt: "¿Qué estructura es la unidad básica de la vida?",
        options: ["La molécula", "La célula", "El tejido", "El órgano"],
        answer: 1,
        explanation: "La célula es la unidad estructural y funcional de todos los seres vivos.",
      },
      {
        type: "elige" as const,
        difficulty: 2 as const,
        prompt: "¿Cuál de las siguientes afirmaciones describe mejor el objeto de estudio de la física?",
        options: [
          "La composición y transformación de las sustancias químicas",
          "La materia, la energía y sus interacciones en el espacio y el tiempo",
          "Los procesos de evolución de los seres vivos",
          "La estructura de las sociedades humanas",
        ],
        answer: 1,
        explanation: "La física estudia la materia y la energía en relación espacio-temporal, no otras ciencias.",
      },
      {
        type: "completa" as const,
        difficulty: 2 as const,
        prompt: "La energía fluye en los ecosistemas desde los productores hacia los ____.",
        options: ["consumidores", "descomponedores", "abióticos"],
        answer: 0,
        explanation: "Los productores pasan energía a los consumidores en la cadena alimenticia.",
      },
      {
        type: "elige" as const,
        difficulty: 2 as const,
        prompt: "¿Cuál es la relación entre productores y consumidores?",
        options: ["Flujo de energía", "Solo clima", "Masa inercial", "Carga eléctrica"],
        answer: 0,
        explanation: "Los consumidores obtienen energía de los productores o de otros consumidores.",
      },
    ];
    for (const item of accepted) {
      expect(GeneratedItemSchema.safeParse(item).success, item.prompt).toBe(true);
    }
  });

  it("accepts elige/completa answers as a valid index or the exact option text", () => {
    expect(GeneratedItemSchema.safeParse(generated.items[2]).success).toBe(true);
    expect(
      GeneratedItemSchema.safeParse({ ...generated.items[2], answer: "Límite y valor" }).success,
    ).toBe(true);
    expect(
      GeneratedItemSchema.safeParse({ ...generated.items[2], answer: "límite y valor" }).success,
    ).toBe(false);
    expect(GeneratedItemSchema.safeParse({ ...generated.items[2], answer: "no está" }).success).toBe(false);
    expect(GeneratedItemSchema.safeParse({ ...generated.items[2], answer: 4 }).success).toBe(false);
    expect(GeneratedItemSchema.safeParse({ ...generated.items[4], answer: "se cumple" }).success).toBe(true);
    expect(GeneratedItemSchema.safeParse({ ...generated.items[4], answer: 1 }).success).toBe(true);
    expect(GeneratedItemSchema.safeParse(generated.items[3]).success).toBe(true);
    expect(GeneratedItemSchema.safeParse({ ...generated.items[3], answer: 0 }).success).toBe(false);
  });

  it("persists exact option-text answers from the model", async () => {
    const withLabels = {
      items: generated.items.map((item) =>
        item.type === "elige" || item.type === "completa"
          ? { ...item, answer: item.options[item.answer as number]! }
          : item,
      ),
    };
    const result = await generateTopicItems({ title: "Límites y continuidad", structuredAdapter: adapterReturning(withLabels) });
    expect(result.payload.items[2]!.answer).toBe("Límite y valor");
    expect(result.payload.items[4]!.answer).toBe("se cumple");
    expect(TopicItemsPayloadSchema.safeParse(result.payload).success).toBe(true);
  });

  it("rejects empty title and explicit adapter failure, preserving costUsd", async () => {
    await expect(generateTopicItems({ title: "  ", structuredAdapter: adapterReturning() })).rejects.toThrow(/title is required/);
    const failed: StructuredAdapter = {
      async generateStructured() {
        return { ok: false, servedBy: null, promptVersion: null, costUsd: 0.002, error: "schema" };
      },
    };
    await expect(generateTopicItems({ title: "Límites", structuredAdapter: failed })).rejects.toMatchObject({
      message: "guided_items_generation_failed",
      costUsd: 0.002,
      reason: "schema",
    });
  });
});
