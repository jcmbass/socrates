import { afterEach, describe, expect, it, vi } from "vitest";
import { CHARS_PER_TOKEN, MAX_TOKENS } from "@buxo/core/truncate";
import { buildFuentesSourceText, buildTopicSessionContext } from "../../src/materials/session-context";
import { emptyFuente, type Fuente } from "@buxo/domain/fuente";

function makeFuente(overrides: Partial<Fuente> = {}): Fuente {
  return emptyFuente({
    subjectId: "subject-1",
    userId: "user-1",
    name: "Guía de Geometría.pdf",
    kind: "pdf",
    text: "Los ángulos internos de un triángulo suman 180 grados.",
    now: new Date("2026-07-21T10:00:00.000Z"),
    ...overrides,
  });
}

function lastFuentesContextLog(spy: ReturnType<typeof vi.spyOn>): {
  msg: string;
  builder: string;
  truncated: boolean;
  droppedTokens: number;
  corpusTokens: number;
  fuenteCount: number;
  subjectId?: string;
  sessionId?: string;
  kind?: string;
} {
  expect(spy).toHaveBeenCalled();
  const raw = spy.mock.calls.at(-1)?.[0];
  expect(typeof raw).toBe("string");
  return JSON.parse(raw as string);
}

describe("buildFuentesSourceText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when there are no fuentes (DF-P11 antialucinación: nothing to ground on)", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(buildFuentesSourceText([])).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("joins multiple fuentes' text, labeled by name", () => {
    const fuentes = [makeFuente({ name: "Guía 1.pdf", text: "Texto A" }), makeFuente({ name: "Guía 2.pdf", text: "Texto B" })];
    const result = buildFuentesSourceText(fuentes);
    expect(result?.text).toContain("Guía 1.pdf");
    expect(result?.text).toContain("Texto A");
    expect(result?.text).toContain("Guía 2.pdf");
    expect(result?.text).toContain("Texto B");
    expect(result?.metrics.builder).toBe("fuentes");
  });

  it("logs truncated=false / droppedTokens=0 and returns metrics (plan-modal-rag F0/F0.1)", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const fuentes = [makeFuente({ text: "Texto corto" })];
    const result = buildFuentesSourceText(fuentes, {
      subjectId: "subj-a",
      sessionId: "sess-a",
      kind: "milestone",
    });
    expect(result?.text).toContain("Texto corto");
    expect(result?.metrics).toMatchObject({
      builder: "fuentes",
      truncated: false,
      droppedTokens: 0,
      fuenteCount: 1,
      subjectId: "subj-a",
      sessionId: "sess-a",
      kind: "milestone",
    });
    expect(result!.metrics.corpusTokens).toBeGreaterThan(0);
    const log = lastFuentesContextLog(spy);
    expect(log.msg).toBe("material.fuentes_context");
    expect(log.truncated).toBe(false);
  });

  it("logs truncated=true and droppedTokens when corpus exceeds budget; text still head+tail", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const oversized = "x".repeat((MAX_TOKENS + 4_000) * CHARS_PER_TOKEN);
    const result = buildFuentesSourceText([makeFuente({ text: oversized })], {
      subjectId: "subj-big",
      sessionId: "sess-big",
      kind: "milestone",
    });
    expect(result?.text).toContain("[...material truncated...]");
    expect(result?.metrics.truncated).toBe(true);
    expect(result!.metrics.droppedTokens).toBeGreaterThan(0);
    expect(result!.metrics.corpusTokens).toBeGreaterThan(MAX_TOKENS);
    const log = lastFuentesContextLog(spy);
    expect(log.truncated).toBe(true);
    expect(log.droppedTokens).toBeGreaterThan(0);
  });
});

describe("buildTopicSessionContext (DF-P12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when there is nothing at all (no topic, no fuentes, no legacy snapshot)", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(buildTopicSessionContext({ topicTitle: null, fuentes: [], materialSnapshotTextRef: null })).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("includes the current topic title when given", () => {
    const result = buildTopicSessionContext({ topicTitle: "Ángulos", fuentes: [], materialSnapshotTextRef: null });
    expect(result?.text).toContain("Tema actual: Ángulos");
    expect(result?.metrics.builder).toBe("topic");
  });

  it("includes the subject's fuentes text", () => {
    const result = buildTopicSessionContext({
      topicTitle: "Ángulos",
      fuentes: [makeFuente({ text: "Los ángulos internos de un triángulo suman 180 grados." })],
      materialSnapshotTextRef: null,
    });
    expect(result?.text).toContain("Los ángulos internos de un triángulo suman 180 grados.");
  });

  it("still includes the legacy materialSnapshotTextRef (pre-P5 mid-session material-asset flow) alongside fuentes", () => {
    const result = buildTopicSessionContext({
      topicTitle: null,
      fuentes: [makeFuente({ text: "Texto de fuente" })],
      materialSnapshotTextRef: "Texto de material legado",
    });
    expect(result?.text).toContain("Texto de fuente");
    expect(result?.text).toContain("Texto de material legado");
  });

  it("works with ONLY a legacy materialSnapshotTextRef (subject-level session, no topic, no fuentes)", () => {
    const result = buildTopicSessionContext({ topicTitle: null, fuentes: [], materialSnapshotTextRef: "Texto de material legado" });
    expect(result?.text).toBe("Texto de material legado");
  });

  it("returns F0.1 metrics for the topic builder without changing returned text", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const text = "Los ángulos internos de un triángulo suman 180 grados.";
    const result = buildTopicSessionContext({
      topicTitle: "Ángulos",
      fuentes: [makeFuente({ text })],
      materialSnapshotTextRef: null,
      meta: { subjectId: "subj-t", sessionId: "sess-t", kind: "topic" },
    });
    expect(result?.text).toContain(text);
    expect(result?.text).toContain("Tema actual: Ángulos");
    expect(result?.metrics).toMatchObject({
      builder: "topic",
      truncated: false,
      droppedTokens: 0,
      fuenteCount: 1,
      subjectId: "subj-t",
      sessionId: "sess-t",
      kind: "topic",
    });
    const log = lastFuentesContextLog(spy);
    expect(log.msg).toBe("material.fuentes_context");
  });
});
