/**
 * Typed client for apps/server's `/v1` contract (F1/WP6 Part 2) — replaces
 * lib/mockTutor.ts + the local-only appStore actions (WP2). PURE and
 * dependency-injected (a `fetchImpl` is passed in, never imported here)
 * specifically so this file stays unit-testable under vitest/node: the
 * REAL fetch implementation is `expo/fetch` (DF-5.2, RN's own `fetch` has
 * only partial response-streaming support), wired in lib/api/expoClient.ts
 * — a separate, untested module, following the exact pattern
 * lib/asyncStorageLocalStore.ts already established for
 * `@react-native-async-storage` ("kept in its own module so nothing vitest
 * touches imports [the native module]").
 *
 * `ApiFetch`/`ApiFetchResponse` below are a minimal STRUCTURAL subset of
 * both the global `fetch`/`Response` (what tests inject) and `expo/fetch`'s
 * `fetch`/`FetchResponse` (what production injects) — duck-typed on
 * purpose so this module depends on neither concrete implementation.
 *
 * `uploadMaterialSubset`/`attachMaterialToSession` (F2 WQ2 Part 2) build a
 * real `FormData`/`Blob` (both globals since Node 18 AND supported by
 * `expo/fetch` — no RN-specific `{uri,name,type}` shape needed, keeping
 * this file testable under plain vitest/node exactly like every other
 * method here) from a `SubsetUploadPlan` (`../materialIngest.ts`'s pure
 * data transform of the WebView bridge's `IngestResult`).
 */
import { ApiError } from "./errors";
import type { Locale } from "../../i18n";
import type { SubsetUploadPlan } from "../materialIngest";

/** Whole-PDF upload plan — full mode (`digestMaterialPdf`), beta-real 08 Option B. */
export type FullUploadPlan = {
  subjectId: string;
  fileName: string;
  /** Production: on-disk URI (never load large PDFs into JS). */
  fileUri?: string;
  /** Test/Node: base64 of the whole PDF. */
  base64?: string;
  /** Idempotency key — same spirit as turn clientMessageId. */
  clientUploadId?: string;
};
import type {
  ActiveSessionSummary,
  ActivityResult,
  Course,
  CreateCourseInput,
  CreateFuenteInput,
  CreateSessionInput,
  CreateSubjectInput,
  Fuente,
  FullStudySession,
  Hito,
  MaterialAsset,
  MeResult,
  SeedAttribution,
  SeedSubjectOption,
  SessionOpening,
  SignupInput,
  StreakResult,
  StudySession,
  Subject,
  Temario,
  TemarioWithVisibility,
  Tema,
  VerifyResult,
  XpSummary,
  TopicItemsResult,
  GuidedAnswerResult,
  GuidedCompleteResult,
} from "./types";

export interface ApiFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  readonly body: ReadableStream<Uint8Array> | null;
}

export type ApiFetch = (url: string, init?: RequestInit) => Promise<ApiFetchResponse>;

export interface ApiClientConfig {
  baseUrl: string;
  fetchImpl: ApiFetch;
}

export interface PostExchangeOptions {
  /** Called with the ACCUMULATED text after every chunk (not just the delta) — matches TutorMessage.tsx's streaming-text contract. */
  onChunk?: (accumulated: string) => void;
  signal?: AbortSignal;
  /**
   * Opaque client-generated id for this pending turn (beta-real 10).
   * Must be stable across retries of the same message; omit on old APKs /
   * callers that have not adopted idempotency yet.
   */
  clientMessageId?: string;
}

/** Optional progress / abort hooks for materials upload (beta-real 07/08). */
export type UploadMaterialSubsetOptions = {
  /** Byte-level upload ratio in [0, 1] while the body is still being sent. */
  onUploadProgress?: (ratio: number) => void;
  /** Fired once the request body finished uploading and the client waits on server digest. */
  onUploadWaiting?: () => void;
  /** Abort in-flight upload (cancel button / unmount). */
  signal?: AbortSignal;
};

export type UploadMaterialFullOptions = UploadMaterialSubsetOptions;

export interface ApiClient {
  signup(input: SignupInput): Promise<void>;
  login(email: string): Promise<void>;
  verify(token: string): Promise<VerifyResult>;

  listCourses(token: string): Promise<Course[]>;
  createCourse(token: string, input: CreateCourseInput): Promise<Course>;

  listSubjects(token: string, courseId: string): Promise<Subject[]>;
  createSubject(token: string, input: CreateSubjectInput): Promise<Subject>;

  listActiveSessions(token: string): Promise<ActiveSessionSummary[]>;
  createSession(token: string, input: CreateSessionInput): Promise<StudySession>;
  getSession(token: string, sessionId: string): Promise<FullStudySession>;
  /**
   * POST /v1/sessions/:id/opening — generate-or-return the tutor opening for
   * an empty topic session. Idempotent; never invents a student message.
   */
  requestOpening(token: string, sessionId: string, opts?: { signal?: AbortSignal }): Promise<SessionOpening>;

  /** POST /v1/materials (mode=subset) — F2 WQ2 Part 1's page-subset endpoint. */
  uploadMaterialSubset(
    token: string,
    plan: SubsetUploadPlan,
    opts?: UploadMaterialSubsetOptions,
  ): Promise<MaterialAsset>;
  /**
   * POST /v1/materials (full PDF, no mode=subset) — server reclassifies every
   * page (`digestMaterialPdf`). Used when the PDF is too large for the
   * WebView bridge (beta-real 08 Option B).
   */
  uploadMaterialFull(token: string, plan: FullUploadPlan, opts?: UploadMaterialFullOptions): Promise<MaterialAsset>;
  /**
   * POST /v1/materials JSON `{ kind: "paste", text, clientUploadId? }`.
   * No picker/UI on mobile today (SourcesModal is PDF-only); this is the
   * typed client for that server path so paste idempotency cannot be forgotten.
   */
  uploadMaterialPaste(
    token: string,
    input: { subjectId: string; text: string; clientUploadId?: string },
  ): Promise<MaterialAsset>;
  /**
   * GET /v1/materials?subjectId=… — caller's materials for one subject
   * (reconcile orphans after a killed client mid-ingest).
   */
  listMaterialsBySubject(token: string, subjectId: string): Promise<MaterialAsset[]>;
  /** POST /v1/sessions/:id/materials — F2 WQ2 Part 2's mid-session attach (see routes/sessions.ts's "DEVIATION #2"). */
  attachMaterialToSession(token: string, sessionId: string, materialAssetId: string): Promise<StudySession>;

  /** GET /v1/streak — R-4: racha actual del estudiante. */
  getStreak(token: string): Promise<StreakResult>;
  /** GET /v1/activity — A-producto-ux §5.2: señales honestas de actividad (sombra en F3). */
  getActivity(token: string): Promise<ActivityResult>;

  /** P4 — GET /v1/xp (no subjectId = total across every subject) or /v1/xp/:subjectId. `visible`/`raw`/`events` come back absent in shadow mode (antifuga, routes/xp.ts) — never a hard error. */
  getXp(token: string, subjectId?: string): Promise<XpSummary>;

  /** D1-b — POST /v1/subjects/:subjectId/topics/:topicId/items:ensure */
  ensureItems(token: string, subjectId: string, topicId: string): Promise<TopicItemsResult>;
  /** D1-b — GET /v1/subjects/:subjectId/topics/:topicId/items */
  listItems(token: string, subjectId: string, topicId: string): Promise<TopicItemsResult>;
  /** D1-c — POST /v1/subjects/:subjectId/topics/:topicId/items/:itemId/answer */
  answerItem(
    token: string,
    subjectId: string,
    topicId: string,
    itemId: string,
    body: { selected: string | number; attempt: 1 | 2; responseMs: number },
  ): Promise<GuidedAnswerResult>;
  /** D1-c — POST /v1/subjects/:subjectId/topics/:topicId/guided:complete */
  completeGuided(token: string, subjectId: string, topicId: string): Promise<GuidedCompleteResult>;

  /** Streams a tutor turn (POST /v1/sessions/:id/exchanges) and resolves the FULL reply text once the stream ends. Throws ApiError — never resolves on a non-2xx or a broken stream. */
  postExchange(token: string, sessionId: string, studentMessage: string, opts?: PostExchangeOptions): Promise<string>;

  /** P2 — GET /v1/temario/:subjectId (includes `visibility` as of plan-xp-progreso Fase 2). */
  getTemario(token: string, subjectId: string): Promise<TemarioWithVisibility>;
  /** P2 — POST /v1/temario/:subjectId (manual, empty temario). */
  createTemario(token: string, subjectId: string): Promise<Temario>;
  /** P2 — POST /v1/temario/:subjectId/temario:generate */
  generateTemario(token: string, subjectId: string, fuenteId: string): Promise<{
    temario: Temario;
    generatedBy: string;
    result: { text: string; servedBy: unknown; promptVersion: string };
  }>;
  /** P2 — POST /v1/temario/:subjectId/topics */
  createTopic(token: string, subjectId: string, title: string, order?: number): Promise<Tema>;
  /** P2 — PATCH /v1/temario/topics/:topicId */
  editTopic(token: string, topicId: string, updates: { title?: string; order?: number; recommended?: boolean }): Promise<Tema>;
  /** P2 — DELETE /v1/temario/topics/:topicId */
  deleteTopic(token: string, topicId: string): Promise<void>;
  /** P2 — POST /v1/temario/:subjectId/topics/reorder */
  reorderTopics(token: string, subjectId: string, orderedIds: string[]): Promise<Tema[]>;
  /** P2 — POST /v1/temario/:subjectId/milestones */
  createMilestone(
    token: string,
    subjectId: string,
    input: { kind: "parcial" | "examen_final"; title: string; coversUpToOrder: number; order?: number },
  ): Promise<Hito>;

  /**
   * P5 — GET /v1/fuentes/:subjectId. Lists the subject's Fuentes (text-only
   * study material, DF-P10/DF-P11) — what `SourcesModal.tsx` renders and
   * what every tutor/milestone turn on this subject leans on server-side.
   */
  listFuentes(token: string, subjectId: string): Promise<Fuente[]>;
  /**
   * P5 — POST /v1/fuentes/:subjectId. The method P3/P4 identified as
   * missing ("subir PDF" had nowhere to land): persists the ALREADY-
   * EXTRACTED text from a PDF/foto as a Fuente. Never sends binary — the
   * caller (`SourcesModal.tsx`) runs the pdf.js ingest pipeline first and
   * passes only the resulting text here (DF-P10: the original is
   * discarded, never uploaded to this endpoint).
   */
  attachSource(token: string, subjectId: string, input: CreateFuenteInput): Promise<Fuente>;
  /** P5 — DELETE /v1/fuentes/:subjectId/:fuenteId. Deletes the TEXT (there is no binary to delete — it never existed). */
  deleteFuente(token: string, subjectId: string, fuenteId: string): Promise<void>;

  /**
   * DELETE /v1/account — tombstone + consent pseudonymization. 202 with
   * empty body. Does not clear local auth; the caller must logout after
   * success and MUST NOT logout on failure.
   */
  deleteAccount(token: string): Promise<void>;

  /**
   * PATCH /v1/me `{ preferredLanguageCode }` — A1 localization: keeps the
   * server's copy of the student's effective UI locale in sync. The server
   * side landed in A3a (apps/server/src/routes/me.ts): 204 empty body on
   * success, 401 without bearer, 400 on an unsupported locale. The sync is
   * still fire-and-forget (`syncPreferredLanguage`,
   * lib/preferredLanguageSync.ts) — a failure must never surface as a
   * user-facing error.
   */
  updatePreferredLanguage(token: string, locale: Locale): Promise<void>;

  /**
   * GET /v1/seed/subjects?level=… — the 5 seed subjects available for a
   * level (C2-a), for onboarding step 2. Public catalog data — no bearer
   * token, matching the server route (`routes/seed.ts`'s docblock).
   */
  getSeedSubjects(level: "bachillerato" | "universidad"): Promise<SeedSubjectOption[]>;
  /**
   * GET /v1/seed/attributions — the 10 unique seed books (CC BY etc.), for
   * the "Atribuciones" screen (C2-a, ADENDA §(b)). Same no-auth pattern.
   */
  getSeedAttributions(): Promise<SeedAttribution[]>;
  /**
   * POST /v1/courses/:courseId/seed-subjects — activates one or more seed
   * subjects on a course: creates the Subject + Temario (topics copied from
   * the catalog in the user's frozen `seedLang`). Idempotent per
   * `(courseId, subjectKey)` — re-sending an already-activated key returns
   * it unchanged rather than duplicating it (C2-a).
   */
  activateSeedSubjects(token: string, courseId: string, subjectKeys: string[]): Promise<Subject[]>;

  /** GET /v1/me — D-C07 onboarding flag (`onboardingCompletedAt`, null until the onboarding flow seals it). */
  getMe(token: string): Promise<MeResult>;
  /**
   * PATCH /v1/me `{ onboardingCompleted: true }` — seals the onboarding
   * flag (D-C07). Same endpoint/contract style as `updatePreferredLanguage`
   * above (204 empty body); the two can be combined server-side but are
   * kept as separate client calls here for caller clarity.
   */
  completeOnboarding(token: string): Promise<void>;
}

async function parseErrorBody(response: ApiFetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Reads a streamed text body progressively, calling `onChunk` with the
 * ACCUMULATED text after every read. A `null` body (no stream support, or
 * an empty 200) resolves to whatever `response.text()` would have given —
 * callers pass `response.body`, so a null body here just means "nothing to
 * stream", not an error.
 */
export async function readStreamedText(
  body: ReadableStream<Uint8Array> | null,
  onChunk?: (accumulated: string) => void,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      onChunk?.(accumulated);
    }
    accumulated += decoder.decode();
  } catch (err) {
    throw new ApiError("network_error", err instanceof Error ? err.message : "Stream read failed");
  }
  return accumulated;
}

/** base64 -> Blob, portable across Node (vitest) and RN/`expo/fetch` — both ship `atob`/`Blob` globals. */
function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  async function raw(path: string, init: RequestInit & { token?: string } = {}): Promise<ApiFetchResponse> {
    const { token, headers, body, ...rest } = init;
    try {
      return await config.fetchImpl(`${config.baseUrl}${path}`, {
        ...rest,
        body,
        headers: {
          // JSON content-type only for our own JSON.stringify(...) string
          // bodies — a FormData body (uploadMaterialSubset) must NOT get
          // this header: fetch sets its own multipart boundary
          // content-type, and overriding it here would corrupt the upload.
          ...(typeof body === "string" ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("network_error", err instanceof Error ? err.message : "Network request failed");
    }
  }

  async function requestJson<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const response = await raw(path, init);
    if (!response.ok) throw ApiError.fromBody(await parseErrorBody(response), response.status);
    return (await response.json()) as T;
  }

  async function requestVoid(path: string, init: RequestInit & { token?: string } = {}): Promise<void> {
    const response = await raw(path, init);
    if (!response.ok) throw ApiError.fromBody(await parseErrorBody(response), response.status);
  }

  return {
    signup(input) {
      return requestVoid("/v1/auth/signup", { method: "POST", body: JSON.stringify(input) });
    },
    login(email) {
      return requestVoid("/v1/auth/login", { method: "POST", body: JSON.stringify({ email }) });
    },
    verify(token) {
      return requestJson<VerifyResult>("/v1/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
    },

    listCourses(token) {
      return requestJson<Course[]>("/v1/courses", { token });
    },
    createCourse(token, input) {
      return requestJson<Course>("/v1/courses", { method: "POST", token, body: JSON.stringify(input) });
    },

    listSubjects(token, courseId) {
      return requestJson<Subject[]>(`/v1/subjects?courseId=${encodeURIComponent(courseId)}`, { token });
    },
    createSubject(token, input) {
      return requestJson<Subject>("/v1/subjects", { method: "POST", token, body: JSON.stringify(input) });
    },

    listActiveSessions(token) {
      return requestJson<ActiveSessionSummary[]>("/v1/sessions?status=active", { token });
    },
    createSession(token, input) {
      return requestJson<StudySession>("/v1/sessions", { method: "POST", token, body: JSON.stringify(input) });
    },
    getSession(token, sessionId) {
      return requestJson<FullStudySession>(`/v1/sessions/${encodeURIComponent(sessionId)}`, { token });
    },
    requestOpening(token, sessionId, opts) {
      return requestJson<SessionOpening>(`/v1/sessions/${encodeURIComponent(sessionId)}/opening`, {
        method: "POST",
        token,
        signal: opts?.signal,
      });
    },

    uploadMaterialSubset(token, plan, _opts) {
      const form = new FormData();
      form.append("subjectId", plan.subjectId);
      form.append("mode", "subset");
      form.append("totalPages", String(plan.totalPages));
      form.append("pages", plan.manifestJson);
      form.append("originalFilename", plan.originalFilename);
      if (plan.clientUploadId) form.append("clientUploadId", plan.clientUploadId);
      for (const file of plan.files) {
        form.append(file.fieldName, base64ToBlob(file.base64, "application/pdf"), file.fileName);
      }
      // Pure/fetch path has no byte-level upload progress (Node/vitest).
      // Production `expoClient` overrides with XHR + MATERIALS_UPLOAD_TIMEOUT_MS.
      _opts?.onUploadWaiting?.();
      return requestJson<MaterialAsset>("/v1/materials", { method: "POST", token, body: form, signal: _opts?.signal });
    },

    uploadMaterialFull(token, plan, _opts) {
      if (!plan.base64) {
        return Promise.reject(new ApiError("invalid_request", "uploadMaterialFull requires base64 in the pure client", 400));
      }
      const form = new FormData();
      form.append("subjectId", plan.subjectId);
      form.append("file", base64ToBlob(plan.base64, "application/pdf"), plan.fileName);
      if (plan.clientUploadId) form.append("clientUploadId", plan.clientUploadId);
      _opts?.onUploadWaiting?.();
      return requestJson<MaterialAsset>("/v1/materials", { method: "POST", token, body: form, signal: _opts?.signal });
    },

    uploadMaterialPaste(token, input) {
      const body: { kind: "paste"; subjectId: string; text: string; clientUploadId?: string } = {
        kind: "paste",
        subjectId: input.subjectId,
        text: input.text,
      };
      if (input.clientUploadId) body.clientUploadId = input.clientUploadId;
      return requestJson<MaterialAsset>("/v1/materials", { method: "POST", token, body: JSON.stringify(body) });
    },

    listMaterialsBySubject(token, subjectId) {
      const q = new URLSearchParams({ subjectId });
      return requestJson<MaterialAsset[]>(`/v1/materials?${q.toString()}`, { token });
    },

    attachMaterialToSession(token, sessionId, materialAssetId) {
      return requestJson<StudySession>(`/v1/sessions/${encodeURIComponent(sessionId)}/materials`, {
        method: "POST",
        token,
        body: JSON.stringify({ materialAssetId }),
      });
    },

    getStreak(token) {
      return requestJson<StreakResult>("/v1/streak", { token });
    },
    getActivity(token) {
      return requestJson<ActivityResult>("/v1/activity", { token });
    },

    getXp(token, subjectId) {
      const path = subjectId ? `/v1/xp/${encodeURIComponent(subjectId)}` : "/v1/xp";
      return requestJson<XpSummary>(path, { token });
    },

    ensureItems(token, subjectId, topicId) {
      return requestJson<TopicItemsResult>(
        `/v1/subjects/${encodeURIComponent(subjectId)}/topics/${encodeURIComponent(topicId)}/items:ensure`,
        { method: "POST", token },
      );
    },

    listItems(token, subjectId, topicId) {
      return requestJson<TopicItemsResult>(
        `/v1/subjects/${encodeURIComponent(subjectId)}/topics/${encodeURIComponent(topicId)}/items`,
        { token },
      );
    },

    answerItem(token, subjectId, topicId, itemId, body) {
      return requestJson<GuidedAnswerResult>(
        `/v1/subjects/${encodeURIComponent(subjectId)}/topics/${encodeURIComponent(topicId)}/items/${encodeURIComponent(itemId)}/answer`,
        { method: "POST", token, body: JSON.stringify(body) },
      );
    },

    completeGuided(token, subjectId, topicId) {
      return requestJson<GuidedCompleteResult>(
        `/v1/subjects/${encodeURIComponent(subjectId)}/topics/${encodeURIComponent(topicId)}/guided:complete`,
        { method: "POST", token },
      );
    },

    async postExchange(token, sessionId, studentMessage, opts = {}) {
      const body: { studentMessage: string; clientMessageId?: string } = { studentMessage };
      if (opts.clientMessageId) body.clientMessageId = opts.clientMessageId;
      const response = await raw(`/v1/sessions/${encodeURIComponent(sessionId)}/exchanges`, {
        method: "POST",
        token,
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (!response.ok) throw ApiError.fromBody(await parseErrorBody(response), response.status);
      return readStreamedText(response.body, opts.onChunk);
    },

    getTemario(token, subjectId) {
      return requestJson<TemarioWithVisibility>(`/v1/temario/${encodeURIComponent(subjectId)}`, { token });
    },

    createTemario(token, subjectId) {
      return requestJson<Temario>(`/v1/temario/${encodeURIComponent(subjectId)}`, { method: "POST", token });
    },

    generateTemario(token, subjectId, fuenteId) {
      return requestJson<{
        temario: Temario;
        generatedBy: string;
        result: { text: string; servedBy: unknown; promptVersion: string };
      }>(`/v1/temario/${encodeURIComponent(subjectId)}/temario:generate`, {
        method: "POST",
        token,
        body: JSON.stringify({ fuenteId }),
      });
    },

    createTopic(token, subjectId, title, order) {
      return requestJson<Tema>(`/v1/temario/${encodeURIComponent(subjectId)}/topics`, {
        method: "POST",
        token,
        body: JSON.stringify({ title, order }),
      });
    },

    editTopic(token, topicId, updates) {
      return requestJson<Tema>(`/v1/temario/topics/${encodeURIComponent(topicId)}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(updates),
      });
    },

    deleteTopic(token, topicId) {
      return requestVoid(`/v1/temario/topics/${encodeURIComponent(topicId)}`, { method: "DELETE", token });
    },

    reorderTopics(token, subjectId, orderedIds) {
      return requestJson<Tema[]>(`/v1/temario/${encodeURIComponent(subjectId)}/topics/reorder`, {
        method: "POST",
        token,
        body: JSON.stringify({ orderedIds }),
      });
    },

    createMilestone(token, subjectId, input) {
      return requestJson<Hito>(`/v1/temario/${encodeURIComponent(subjectId)}/milestones`, {
        method: "POST",
        token,
        body: JSON.stringify(input),
      });
    },

    listFuentes(token, subjectId) {
      return requestJson<Fuente[]>(`/v1/fuentes/${encodeURIComponent(subjectId)}`, { token });
    },

    attachSource(token, subjectId, input) {
      return requestJson<Fuente>(`/v1/fuentes/${encodeURIComponent(subjectId)}`, {
        method: "POST",
        token,
        body: JSON.stringify(input),
      });
    },

    deleteFuente(token, subjectId, fuenteId) {
      return requestVoid(`/v1/fuentes/${encodeURIComponent(subjectId)}/${encodeURIComponent(fuenteId)}`, { method: "DELETE", token });
    },

    deleteAccount(token) {
      return requestVoid("/v1/account", { method: "DELETE", token });
    },

    updatePreferredLanguage(token, locale) {
      return requestVoid("/v1/me", {
        method: "PATCH",
        token,
        body: JSON.stringify({ preferredLanguageCode: locale }),
      });
    },

    getSeedSubjects(level) {
      return requestJson<SeedSubjectOption[]>(`/v1/seed/subjects?level=${encodeURIComponent(level)}`);
    },
    getSeedAttributions() {
      return requestJson<SeedAttribution[]>("/v1/seed/attributions");
    },
    activateSeedSubjects(token, courseId, subjectKeys) {
      return requestJson<Subject[]>(`/v1/courses/${encodeURIComponent(courseId)}/seed-subjects`, {
        method: "POST",
        token,
        body: JSON.stringify({ subjectKeys }),
      });
    },

    getMe(token) {
      return requestJson<MeResult>("/v1/me", { token });
    },
    completeOnboarding(token) {
      return requestVoid("/v1/me", {
        method: "PATCH",
        token,
        body: JSON.stringify({ onboardingCompleted: true }),
      });
    },
  };
}
