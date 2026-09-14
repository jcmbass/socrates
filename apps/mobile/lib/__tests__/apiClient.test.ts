/**
 * lib/api/client.ts — pure, dependency-injected, zero react-native/expo
 * imports (see that file's module doc). Tests inject a fake `ApiFetch` that
 * never touches the network; the streaming tests use a REAL
 * `ReadableStream` (Node global) to exercise `readStreamedText` exactly the
 * way a genuine chunked HTTP body would.
 */
import { describe, expect, it, vi } from "vitest";
import { createApiClient, readStreamedText, type ApiFetch, type ApiFetchResponse } from "../api/client";
import { ApiError, isNetworkError, isQuotaExceeded, isUnauthorized } from "../api/errors";

function jsonResponse(status: number, body: unknown): ApiFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    body: null,
  };
}

function emptyResponse(status: number): ApiFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error("no body")),
    text: () => Promise.resolve(""),
    body: null,
  };
}

function streamResponse(status: number, chunks: string[]): ApiFetchResponse {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(chunks.join("")),
    body: stream,
  };
}

describe("readStreamedText", () => {
  it("accumulates chunks and calls onChunk with the running total", async () => {
    const chunks: string[] = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("hola "));
        controller.enqueue(encoder.encode("mundo"));
        controller.close();
      },
    });
    const full = await readStreamedText(stream, (acc) => chunks.push(acc));
    expect(full).toBe("hola mundo");
    expect(chunks).toEqual(["hola ", "hola mundo"]);
  });

  it("returns an empty string for a null body", async () => {
    expect(await readStreamedText(null)).toBe("");
  });

  it("wraps a broken stream as a network_error ApiError", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    await expect(readStreamedText(stream)).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("createApiClient", () => {
  it("signup() posts the payload and resolves on 202 with no body", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => emptyResponse(202));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    await client.signup({ email: "a@b.com", displayName: "A", ageConfirmedAt: "2026-01-01T00:00:00.000Z", consents: [] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://test/v1/auth/signup",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("verify() returns {userId, token, email, displayName} on success", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () =>
      jsonResponse(200, { userId: "u1", token: "tok", email: "a@b.com", displayName: "Ada" }),
    );
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    await expect(client.verify("magic-token")).resolves.toEqual({
      userId: "u1",
      token: "tok",
      email: "a@b.com",
      displayName: "Ada",
    });
  });

  it("verify() throws ApiError with the server's code on a 401", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(401, { error: "Invalid magic link", code: "unauthorized" }));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const err = await client.verify("bad-token").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isUnauthorized(err)).toBe(true);
  });

  it("listCourses() attaches the bearer token", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, []));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    await client.listCourses("tok123");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok123");
  });

  it("createSubject() sends a JSON content-type header and body", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "s1", name: "Cálculo" }));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    await client.createSubject("tok", { courseId: "c1", name: "Cálculo" });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init!.body).toBe(JSON.stringify({ courseId: "c1", name: "Cálculo" }));
  });

  it("postExchange() streams the reply and resolves the full text", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => streamResponse(200, ["¿Qué ", "pensás ", "vos?"]));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const chunks: string[] = [];
    const full = await client.postExchange("tok", "sess1", "no sé", { onChunk: (acc) => chunks.push(acc) });
    expect(full).toBe("¿Qué pensás vos?");
    expect(chunks).toEqual(["¿Qué ", "¿Qué pensás ", "¿Qué pensás vos?"]);
  });

  it("postExchange() sends clientMessageId when provided (beta-real 10)", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => streamResponse(200, ["ok"]));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    await client.postExchange("tok", "sess1", "hola", { clientMessageId: "cm-stable-1" });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init!.body).toBe(JSON.stringify({ studentMessage: "hola", clientMessageId: "cm-stable-1" }));
  });

  it("postExchange() surfaces duplicate_turn on 409", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () =>
      jsonResponse(409, { error: "This turn was already completed", code: "duplicate_turn" }),
    );
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const err = await client.postExchange("tok", "sess1", "hola", { clientMessageId: "cm-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("duplicate_turn");
    expect(err.status).toBe(409);
  });

  it("postExchange() throws quota_exceeded on a 429 WITHOUT reading any stream", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () =>
      jsonResponse(429, { error: "Tutor message quota exceeded (daily_messages)", code: "quota_exceeded" }),
    );
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const err = await client.postExchange("tok", "sess1", "hola").catch((e) => e);
    expect(isQuotaExceeded(err)).toBe(true);
  });

  it("postExchange() renders a safety-blocked reply exactly like a normal 200 (server sends it in-band, C-backend §3.2)", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => streamResponse(200, ["No puedo continuar con la sesión..."]));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    await expect(client.postExchange("tok", "sess1", "algo grave")).resolves.toContain("No puedo continuar");
  });

  it("postExchange() surfaces a network failure as network_error (mid-stream drop)", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => {
      throw new TypeError("Network request failed");
    });
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const err = await client.postExchange("tok", "sess1", "hola").catch((e) => e);
    expect(isNetworkError(err)).toBe(true);
  });

  it("getSession() returns the full session with its exchanges", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, { id: "sess1", exchanges: [{ id: "e1" }] }));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const session = await client.getSession("tok", "sess1");
    expect(session.exchanges).toHaveLength(1);
  });

  it("requestOpening() POSTs /v1/sessions/:id/opening and returns the persisted opening", async () => {
    const body = {
      id: "op1",
      sessionId: "sess1",
      text: "Una idea breve. ¿Qué pasa si duplicás x?",
      tutorModelId: "m",
      tutorProviderId: "p",
      tutorPromptVersion: "buxo-socratic-v3",
      grounding: "fuentes",
      createdAt: "2026-09-07T12:00:00.000Z",
      schemaVersion: 1,
    };
    const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, body));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const opening = await client.requestOpening("tok", "sess1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://test/v1/sessions/sess1/opening",
      expect.objectContaining({ method: "POST" }),
    );
    expect(opening.text).toBe(body.text);
    expect(opening.grounding).toBe("fuentes");
  });

  it("requestOpening() forwards AbortSignal", async () => {
    const body = {
      id: "op1",
      sessionId: "sess1",
      text: "x",
      tutorModelId: "m",
      tutorProviderId: "p",
      tutorPromptVersion: "v",
      grounding: "general",
      createdAt: "2026-09-07T12:00:00.000Z",
      schemaVersion: 1,
    };
    const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, body));
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const controller = new AbortController();
    await client.requestOpening("tok", "sess1", { signal: controller.signal });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://test/v1/sessions/sess1/opening",
      expect.objectContaining({ method: "POST", signal: controller.signal }),
    );
  });

  it("requestOpening() surfaces conflict on 409 without inventing a student turn", async () => {
    const fetchImpl = vi.fn<ApiFetch>(async () =>
      jsonResponse(409, { error: "Session already has exchanges", code: "conflict" }),
    );
    const client = createApiClient({ baseUrl: "http://test", fetchImpl });
    const err = await client.requestOpening("tok", "sess1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("conflict");
    expect(err.status).toBe(409);
  });

  describe("getXp (P4)", () => {
    it("hits /v1/xp (no subjectId) for the user-wide total", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, { policy: "subtract", subjectId: null }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.getXp("tok");
      expect(fetchImpl.mock.calls[0]![0]).toBe("http://test/v1/xp");
    });

    it("hits /v1/xp/:subjectId when a subject is given", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, { raw: 40, visible: 40, policy: "subtract", subjectId: "s1" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const xp = await client.getXp("tok", "s1");
      expect(fetchImpl.mock.calls[0]![0]).toBe("http://test/v1/xp/s1");
      expect(xp.visible).toBe(40);
    });

    it("resolves a shadow-mode payload with visible/raw/events absent, without throwing", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, { policy: "subtract", subjectId: null }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const xp = await client.getXp("tok");
      expect(xp.visible).toBeUndefined();
      expect(xp.policy).toBe("subtract");
    });
  });

  describe("uploadMaterialSubset (F2 WQ2 Part 2)", () => {
    it("sends a FormData body WITHOUT the json content-type header (must not stomp fetch's own multipart boundary)", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "mat1", status: "ready" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.uploadMaterialSubset("tok", {
        subjectId: "subj1",
        totalPages: 2,
        manifestJson: JSON.stringify([{ pageNumber: 1, claimedTier: "local", localText: "x" }]),
        originalFilename: "guia.pdf",
        files: [{ fieldName: "cloudPage-2", fileName: "page-2.pdf", base64: "UERGQllURVM=" }],
      });

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe("http://test/v1/materials");
      expect(init!.method).toBe("POST");
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
      expect((init!.headers as Record<string, string>)["content-type"]).toBeUndefined();

      const form = init!.body as FormData;
      expect(form.get("subjectId")).toBe("subj1");
      expect(form.get("mode")).toBe("subset");
      expect(form.get("totalPages")).toBe("2");
      expect(form.get("originalFilename")).toBe("guia.pdf");
      const uploadedFile = form.get("cloudPage-2");
      expect(uploadedFile).toBeInstanceOf(Blob);
      expect((uploadedFile as Blob).type).toBe("application/pdf");
    });

    it("sends clientUploadId when provided (material idempotency)", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "mat1", status: "ready" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.uploadMaterialSubset("tok", {
        subjectId: "subj1",
        totalPages: 1,
        manifestJson: "[]",
        originalFilename: "guia.pdf",
        files: [],
        clientUploadId: "cu-stable-1",
      });
      const form = fetchImpl.mock.calls[0]![1]!.body as FormData;
      expect(form.get("clientUploadId")).toBe("cu-stable-1");
    });

    it("surfaces duplicate_material on 409", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () =>
        jsonResponse(409, { error: "This material upload was already received", code: "duplicate_material" }),
      );
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const err = await client
        .uploadMaterialSubset("tok", {
          subjectId: "s1",
          totalPages: 1,
          manifestJson: "[]",
          originalFilename: "a.pdf",
          files: [],
          clientUploadId: "cu-1",
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe("duplicate_material");
    });

    it("resolves the created MaterialAsset", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "mat1", status: "ready", kind: "pdf" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const material = await client.uploadMaterialSubset("tok", {
        subjectId: "subj1",
        totalPages: 1,
        manifestJson: "[]",
        originalFilename: "guia.pdf",
        files: [],
      });
      expect(material).toMatchObject({ id: "mat1", status: "ready" });
    });

    it("throws quota_exceeded on a 429 (ingest quota, F2 WQ1 §2.5)", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(429, { error: "Ingest quota exceeded", code: "quota_exceeded" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const err = await client
        .uploadMaterialSubset("tok", { subjectId: "s1", totalPages: 1, manifestJson: "[]", originalFilename: "a.pdf", files: [] })
        .catch((e) => e);
      expect(isQuotaExceeded(err)).toBe(true);
    });
  });

  describe("uploadMaterialFull (beta-real 08 Option B)", () => {
    it("posts the whole PDF as file without mode=subset", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "mat-full", status: "ready" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.uploadMaterialFull("tok", {
        subjectId: "subj1",
        fileName: "The_Distributed_Node.pdf",
        base64: "UERGQllURVM=",
        clientUploadId: "cu-full-1",
      });
      const [, init] = fetchImpl.mock.calls[0]!;
      const form = init!.body as FormData;
      expect(form.get("subjectId")).toBe("subj1");
      expect(form.get("mode")).toBeNull();
      expect(form.get("clientUploadId")).toBe("cu-full-1");
      expect(form.get("file")).toBeInstanceOf(Blob);
    });
  });

  describe("attachMaterialToSession (F2 WQ2 Part 2)", () => {
    it("posts { materialAssetId } as JSON and returns the updated session", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, { id: "sess1", materialAssetIds: ["mat1"] }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const session = await client.attachMaterialToSession("tok", "sess1", "mat1");

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe("http://test/v1/sessions/sess1/materials");
      expect(init!.body).toBe(JSON.stringify({ materialAssetId: "mat1" }));
      expect((init!.headers as Record<string, string>)["content-type"]).toBe("application/json");
      expect((session as { materialAssetIds: string[] }).materialAssetIds).toEqual(["mat1"]);
    });

    it("throws not_found when the session doesn't exist", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(404, { error: "Session not found", code: "not_found" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const err = await client.attachMaterialToSession("tok", "gone", "mat1").catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("not_found");
    });
  });

  describe("createSession with topicId/milestoneId (P5, DF-P12/DF-P05)", () => {
    it("threads topicId through to the POST body", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "sess1", kind: "topic", topicId: "topic-1" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.createSession("tok", { subjectId: "subj1", topicId: "topic-1" });

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe("http://test/v1/sessions");
      expect(init!.body).toBe(JSON.stringify({ subjectId: "subj1", topicId: "topic-1" }));
    });

    it("threads milestoneId through to the POST body", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "sess1", kind: "milestone", milestoneId: "m1" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.createSession("tok", { subjectId: "subj1", milestoneId: "m1" });

      const [, init] = fetchImpl.mock.calls[0]!;
      expect(init!.body).toBe(JSON.stringify({ subjectId: "subj1", milestoneId: "m1" }));
    });
  });

  describe("listMaterialsBySubject (orphan reconcile)", () => {
    it("GETs /v1/materials?subjectId=…", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () =>
        jsonResponse(200, [{ id: "mat1", originalFilename: "guia.pdf", status: "ready", digestedTextRef: "hola" }]),
      );
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const list = await client.listMaterialsBySubject("tok", "subj1");

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe("http://test/v1/materials?subjectId=subj1");
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: "mat1", originalFilename: "guia.pdf" });
    });
  });

  describe("Fuentes — listFuentes/attachSource/deleteFuente (P5, DF-P10/DF-P11)", () => {
    it("listFuentes GETs /v1/fuentes/:subjectId and returns the array", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(200, [{ id: "f1", name: "Guía.pdf", kind: "pdf", text: "..." }]));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const fuentes = await client.listFuentes("tok", "subj1");

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe("http://test/v1/fuentes/subj1");
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
      expect(fuentes).toHaveLength(1);
      expect(fuentes[0]).toMatchObject({ id: "f1", name: "Guía.pdf" });
    });

    it("attachSource POSTs {name, kind, text} — the client-side wiring P3/P4 left missing — and never a binary field", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "f1", name: "Guía.pdf", kind: "pdf", text: "texto extraído" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const fuente = await client.attachSource("tok", "subj1", { name: "Guía.pdf", kind: "pdf", text: "texto extraído" });

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe("http://test/v1/fuentes/subj1");
      expect(init!.method).toBe("POST");
      const sentBody = JSON.parse(init!.body as string);
      expect(sentBody).toEqual({ name: "Guía.pdf", kind: "pdf", text: "texto extraído" });
      // DF-P10: no field here could ever carry a binary — the type itself has none.
      expect(Object.keys(sentBody).sort()).toEqual(["kind", "name", "text"]);
      expect(fuente.text).toBe("texto extraído");
    });

    it("deleteFuente DELETEs /v1/fuentes/:subjectId/:fuenteId and resolves on 204", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => emptyResponse(204));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.deleteFuente("tok", "subj1", "f1");

      expect(fetchImpl).toHaveBeenCalledWith(
        "http://test/v1/fuentes/subj1/f1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("throws not_found when the fuente doesn't exist", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(404, { error: "Fuente not found", code: "not_found" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const err = await client.deleteFuente("tok", "subj1", "gone").catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("not_found");
    });
  });

  describe("uploadMaterialPaste (E15 paste idempotency)", () => {
    it("POSTs JSON {kind:paste, subjectId, text, clientUploadId}", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => jsonResponse(201, { id: "mat-paste", kind: "paste", status: "ready" }));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.uploadMaterialPaste("tok", { subjectId: "subj1", text: "hola", clientUploadId: "cu-paste-1" });
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe("http://test/v1/materials");
      expect(init!.method).toBe("POST");
      expect(JSON.parse(init!.body as string)).toEqual({
        kind: "paste",
        subjectId: "subj1",
        text: "hola",
        clientUploadId: "cu-paste-1",
      });
    });

    it("surfaces duplicate_material on 409", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () =>
        jsonResponse(409, { error: "This material upload was already received", code: "duplicate_material" }),
      );
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const err = await client
        .uploadMaterialPaste("tok", { subjectId: "s1", text: "hola", clientUploadId: "cu-1" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe("duplicate_material");
    });
  });

  describe("deleteAccount (Play B16)", () => {
    it("DELETEs /v1/account and resolves on 202", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => emptyResponse(202));
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      await client.deleteAccount("tok");
      expect(fetchImpl).toHaveBeenCalledWith(
        "http://test/v1/account",
        expect.objectContaining({ method: "DELETE" }),
      );
      const [, init] = fetchImpl.mock.calls[0]!;
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
    });

    it("throws network_error without treating it as success", async () => {
      const fetchImpl = vi.fn<ApiFetch>(async () => {
        throw new TypeError("Failed to fetch");
      });
      const client = createApiClient({ baseUrl: "http://test", fetchImpl });
      const err = await client.deleteAccount("tok").catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(isNetworkError(err)).toBe(true);
    });
  });
});
