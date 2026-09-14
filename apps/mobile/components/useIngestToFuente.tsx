/**
 * Shared "pick PDF → WebView parse → attachSource → Fuente" host
 * (beta-real 05). Owns the hidden ingest WebView and the ingest state
 * machine — the same pipeline SourcesModal used to inline.
 *
 * beta-real 08:
 * - Busy feedback never mute (`ingestStatusMessage`).
 * - WebView parse timeout + cancel button.
 * - Large PDFs (by bytes) skip the WebView and upload full for server classify
 *   (`digestMaterialPdf` / Option B).
 * - PDFs over the subset page cap also upload full (server book-index path)
 *   instead of a client-side `too_many_pages` reject — early exit on the
 *   first WebView `progress` so the phone never walks 400 pages.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { apiClient } from "../lib/api/expoClient";
import { ApiError } from "../lib/api/errors";
import type { Fuente } from "../lib/api/types";
import { resolveClientUploadId } from "../lib/clientUploadId";
import {
  buildSubsetUploadPlan,
  classifyIngestError,
  clientUploadModeForPageCount,
} from "../lib/materialIngest";
import { WEBVIEW_PARSE_TIMEOUT_MS } from "../lib/materialIngestLimits";
import { pickPdf } from "../lib/materialPicker";
import { parseWebToHostMessage, type IngestResult } from "../lib/materialIngestBridge";
import { IDLE_STATE, ingestReducer, isIngestAwaitingServer, isIngestBusy, type IngestState } from "../lib/materialIngestState";
import { materialIngestErrorCopy } from "../lib/ingestErrorCopy";
import { useT } from "../i18n/react";
import {
  MATERIAL_INGEST_BASE_URL,
  MATERIAL_INGEST_WEBVIEW_HTML,
} from "../materials/generated/material-ingest-webview.generated";

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `source-ingest-${Date.now()}-${requestCounter}`;
}

export type UseIngestToFuenteOptions = {
  token: string;
  onFuente: (fuente: Fuente, subjectId: string) => void | Promise<void>;
  onError?: (
    kind: Exclude<import("../lib/materialIngestState").IngestErrorKind, "cancelled">,
    message: string,
    subjectId: string,
  ) => void;
  onCancelled?: (subjectId: string) => void;
  /**
   * Fired right after the student confirms a PDF (FILE_PICKED) — before
   * parse/upload. Screens close the Fuentes modal here so the student can
   * keep chatting while ingest continues on the screen-owned host.
   */
  onFilePicked?: (fileName: string, subjectId: string) => void;
  errorMessageFor?: (kind: Exclude<import("../lib/materialIngestState").IngestErrorKind, "cancelled">) => string;
  /**
   * Server already has this upload (`409 duplicate_material`). Not a red
   * error — parent should reconcile via GET (same spirit as duplicate_turn).
   */
  onDuplicateMaterial?: (subjectId: string) => void;
};

export type UseIngestToFuenteResult = {
  ingest: IngestState;
  busy: boolean;
  startPick: (subjectId: string) => Promise<void>;
  /** Student-driven cancel — clears timers, aborts upload, returns to idle. */
  cancel: () => void;
  reset: () => void;
  host: ReactElement;
};

export function useIngestToFuente(options: UseIngestToFuenteOptions): UseIngestToFuenteResult {
  const t = useT();
  const webviewRef = useRef<WebView>(null);
  const requestIdRef = useRef<string | null>(null);
  const subjectIdRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  /** When true, unmount must NOT abort — student chose "Dejar de esperar" (09 P2b). */
  const keepAliveRef = useRef(false);
  const ingestRef = useRef<IngestState>(IDLE_STATE);
  /**
   * Identidad de la corrida que MANDA sobre la UI.
   *
   * El rescate de P2b deja una subida viva después de que el estudiante se
   * fue. Sin esta identidad, esa corrida huérfana seguía escribiendo estado:
   * si el estudiante volvía a subir, `startPick` abortaba su controller y el
   * `catch` pintaba un error de red **atribuido al intento nuevo** — y encima
   * se perdía el trabajo ya pagado, justo lo que el rescate venía a evitar.
   *
   * Una corrida huérfana puede seguir ADJUNTANDO (es el punto del rescate),
   * pero no puede tocar progreso ni errores.
   */
  const runIdRef = useRef(0);
  const ownsUi = useCallback((runId: number) => runId === runIdRef.current && !cancelledRef.current, []);
  /** On-disk URI from the picker — needed when page count forces full upload mid-parse. */
  const pickedUriRef = useRef<string | null>(null);
  const pickedFileNameRef = useRef<string | null>(null);
  /** Reused across retries of the same pick — defeats double-charge. */
  const pendingClientUploadIdRef = useRef<string | null>(null);

  const [ingest, setIngest] = useState<IngestState>(IDLE_STATE);
  ingestRef.current = ingest;

  function dispatch(action: Parameters<typeof ingestReducer>[1]) {
    setIngest((prev) => ingestReducer(prev, action));
  }

  const clearParseTimer = useCallback(() => {
    if (parseTimerRef.current) {
      clearTimeout(parseTimerRef.current);
      parseTimerRef.current = null;
    }
  }, []);

  const abortUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
  }, []);

  /**
   * Watchdog on the WebView. Re-armed on EVERY progress message, not just the
   * first: a bridge that dies mid-parse (page 3 of 15) is the same mute hang
   * as one that never answers.
   */
  const armParseTimer = useCallback(
    (requestId: string, subjectId: string) => {
      clearParseTimer();
      parseTimerRef.current = setTimeout(() => {
        if (requestIdRef.current !== requestId) return;
        requestIdRef.current = null;
        const msg = t.materialIngest.errors.timeout;
        dispatch({ type: "PARSE_TIMEOUT", message: msg });
        optionsRef.current.onError?.("timeout", msg, subjectId);
      }, WEBVIEW_PARSE_TIMEOUT_MS);
    },
    // `t` (useT) — student-facing copy; recreate on locale change.
    [clearParseTimer, t],
  );

  const reset = useCallback(() => {
    clearParseTimer();
    abortUpload();
    cancelledRef.current = false;
    keepAliveRef.current = false;
    setIngest(IDLE_STATE);
    requestIdRef.current = null;
    subjectIdRef.current = null;
    pickedUriRef.current = null;
    pickedFileNameRef.current = null;
  }, [abortUpload, clearParseTimer]);

  const cancel = useCallback(() => {
    // Soft rescue (09 P2b): once the server is digesting, aborting only
    // discards the paid result. Leave the XHR alive and attach when it returns.
    if (isIngestAwaitingServer(ingestRef.current)) {
      keepAliveRef.current = true;
      clearParseTimer();
      requestIdRef.current = null;
      // DESACOPLAR el controller sin abortarlo: así ni el desmontaje ni un
      // `startPick` posterior pueden matar la corrida que prometimos rescatar.
      uploadAbortRef.current = null;
      // La corrida sigue viva pero deja de mandar sobre la UI.
      runIdRef.current += 1;
      dispatch({ type: "CANCEL" });
      const subjectId = subjectIdRef.current;
      if (subjectId) optionsRef.current.onCancelled?.(subjectId);
      return;
    }
    keepAliveRef.current = false;
    cancelledRef.current = true;
    clearParseTimer();
    abortUpload();
    requestIdRef.current = null;
    dispatch({ type: "CANCEL" });
    const subjectId = subjectIdRef.current;
    if (subjectId) optionsRef.current.onCancelled?.(subjectId);
  }, [abortUpload, clearParseTimer]);

  useEffect(() => {
    return () => {
      clearParseTimer();
      if (!keepAliveRef.current) abortUpload();
    };
  }, [abortUpload, clearParseTimer]);

  const attachFuenteFromText = useCallback(
    async (fileName: string, extractedText: string, subjectId: string, runId: number) => {
      const { token, onFuente, onError, errorMessageFor } = optionsRef.current;
      if (cancelledRef.current) return;
      // Una corrida huérfana (rescate de P2b) SÍ adjunta — es lo que le
      // prometimos al estudiante — pero sin pintar fases en la UI.
      const owns = ownsUi(runId);
      if (owns) dispatch({ type: "ATTACH_STARTED" });
      try {
        const fuente = await apiClient.attachSource(token, subjectId, {
          name: fileName,
          kind: "pdf",
          text: extractedText,
        });
        if (cancelledRef.current) return;
        if (ownsUi(runId)) dispatch({ type: "ATTACH_SUCCEEDED", materialId: fuente.id });
        await onFuente(fuente, subjectId);
      } catch (err) {
        if (!ownsUi(runId)) return;
        const { kind, message } = classifyIngestError(err);
        const msg = errorMessageFor?.(kind) || materialIngestErrorCopy(kind, message) || message;
        dispatch({ type: "ATTACH_FAILED", kind, message: msg });
        onError?.(kind, msg, subjectId);
      }
    },
    [ownsUi],
  );

  const uploadFullAndAttach = useCallback(
    async (fileName: string, fileUri: string, subjectId: string) => {
      const { token, onError, errorMessageFor, onDuplicateMaterial } = optionsRef.current;
      const runId = runIdRef.current;
      dispatch({ type: "UPLOAD_STARTED" });
      const clientUploadId = resolveClientUploadId(pendingClientUploadIdRef.current);
      pendingClientUploadIdRef.current = clientUploadId;
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      let extractedText: string;
      try {
        const material = await apiClient.uploadMaterialFull(
          token,
          { subjectId, fileName, fileUri, clientUploadId },
          {
            signal: controller.signal,
            onUploadProgress: (ratio) => {
              if (ownsUi(runId)) dispatch({ type: "UPLOAD_PROGRESS", ratio });
            },
            onUploadWaiting: () => {
              if (ownsUi(runId)) dispatch({ type: "UPLOAD_WAITING" });
            },
          },
        );
        pendingClientUploadIdRef.current = null;
        extractedText = material.digestedTextRef;
      } catch (err) {
        if (!ownsUi(runId)) return;
        if (err instanceof ApiError && err.code === "duplicate_material") {
          pendingClientUploadIdRef.current = null;
          dispatch({ type: "DISMISS" });
          onDuplicateMaterial?.(subjectId);
          return;
        }
        const { kind, message } = classifyIngestError(err);
        const msg = errorMessageFor?.(kind) || materialIngestErrorCopy(kind, message) || message;
        dispatch({ type: "UPLOAD_FAILED", kind, message: msg });
        onError?.(kind, msg, subjectId);
        return;
      } finally {
        // Solo limpiar si sigue siendo NUESTRO: una corrida vieja no debe
        // borrar el controller de la corrida nueva.
        if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      }
      await attachFuenteFromText(fileName, extractedText, subjectId, runId);
    },
    [attachFuenteFromText, ownsUi],
  );

  const createFuenteFromIngest = useCallback(
    async (result: IngestResult) => {
      const subjectId = subjectIdRef.current;
      const { token, onError, errorMessageFor, onDuplicateMaterial } = optionsRef.current;
      if (!subjectId || cancelledRef.current) return;

      // Over the subset page cap → full upload (server book-index / classify).
      if (clientUploadModeForPageCount(result.totalPages) === "full") {
        const uri = pickedUriRef.current;
        if (!uri) {
          const kind = "too_many_pages" as const;
          const msg = errorMessageFor?.(kind) || materialIngestErrorCopy(kind);
          dispatch({ type: "UPLOAD_FAILED", kind, message: msg });
          onError?.(kind, msg, subjectId);
          return;
        }
        void uploadFullAndAttach(result.fileName, uri, subjectId);
        return;
      }

      const runId = runIdRef.current;
      dispatch({ type: "UPLOAD_STARTED" });
      const clientUploadId = resolveClientUploadId(pendingClientUploadIdRef.current);
      pendingClientUploadIdRef.current = clientUploadId;
      const plan = { ...buildSubsetUploadPlan(subjectId, result), clientUploadId };
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      let extractedText: string;
      try {
        const material = await apiClient.uploadMaterialSubset(token, plan, {
          signal: controller.signal,
          onUploadProgress: (ratio) => {
            if (ownsUi(runId)) dispatch({ type: "UPLOAD_PROGRESS", ratio });
          },
          onUploadWaiting: () => {
            if (ownsUi(runId)) dispatch({ type: "UPLOAD_WAITING" });
          },
        });
        pendingClientUploadIdRef.current = null;
        extractedText = material.digestedTextRef;
      } catch (err) {
        if (!ownsUi(runId)) return;
        if (err instanceof ApiError && err.code === "duplicate_material") {
          pendingClientUploadIdRef.current = null;
          dispatch({ type: "DISMISS" });
          onDuplicateMaterial?.(subjectId);
          return;
        }
        const { kind, message } = classifyIngestError(err);
        const msg = errorMessageFor?.(kind) || materialIngestErrorCopy(kind, message) || message;
        dispatch({ type: "UPLOAD_FAILED", kind, message: msg });
        onError?.(kind, msg, subjectId);
        return;
      } finally {
        if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      }

      await attachFuenteFromText(result.fileName, extractedText, subjectId, runId);
    },
    [attachFuenteFromText, ownsUi, uploadFullAndAttach],
  );

  const startPick = useCallback(
    async (subjectId: string) => {
      const { onError, errorMessageFor } = optionsRef.current;
      subjectIdRef.current = subjectId;
      cancelledRef.current = false;
      keepAliveRef.current = false;
      // Corrida nueva: las anteriores pierden la UI. Un rescate en vuelo ya
      // desacopló su controller, así que `abortUpload` no lo alcanza.
      runIdRef.current += 1;
      clearParseTimer();
      abortUpload();
      pendingClientUploadIdRef.current = null;
      dispatch({ type: "PICK_STARTED" });
      let picked: Awaited<ReturnType<typeof pickPdf>>;
      try {
        picked = await pickPdf();
      } catch (err) {
        const { kind, message } = classifyIngestError(err);
        const msg = errorMessageFor?.(kind) || materialIngestErrorCopy(kind, message) || message;
        dispatch({ type: "PARSE_FAILED", message: msg });
        onError?.(kind, msg, subjectId);
        return;
      }
      if (!picked) {
        dispatch({ type: "PICK_CANCELLED" });
        optionsRef.current.onCancelled?.(subjectId);
        return;
      }
      if (cancelledRef.current) return;

      dispatch({ type: "FILE_PICKED", fileName: picked.fileName });
      pickedUriRef.current = picked.uri;
      pickedFileNameRef.current = picked.fileName;
      optionsRef.current.onFilePicked?.(picked.fileName, subjectId);

      // Large PDF: skip WebView — upload whole file for server classify (Option B).
      if (picked.base64 === null) {
        void uploadFullAndAttach(picked.fileName, picked.uri, subjectId);
        return;
      }

      const requestId = nextRequestId();
      requestIdRef.current = requestId;
      armParseTimer(requestId, subjectId);

      webviewRef.current?.postMessage(
        JSON.stringify({ type: "ingest", requestId, fileName: picked.fileName, pdfBase64: picked.base64 }),
      );
    },
    [abortUpload, armParseTimer, clearParseTimer, uploadFullAndAttach],
  );

  function handleWebviewMessage(event: WebViewMessageEvent) {
    const msg = parseWebToHostMessage(event.nativeEvent.data);
    if (!msg || msg.requestId !== requestIdRef.current) return;
    switch (msg.type) {
      case "progress": {
        // Page count over subset cap → stop parsing early and upload the
        // whole PDF (same Option B path as oversized binaries). Avoids
        // walking 400 pages on-device for nothing.
        if (clientUploadModeForPageCount(msg.total) === "full" && subjectIdRef.current) {
          clearParseTimer();
          requestIdRef.current = null;
          const uri = pickedUriRef.current;
          const fileName = pickedFileNameRef.current ?? "documento.pdf";
          if (uri) {
            void uploadFullAndAttach(fileName, uri, subjectIdRef.current);
          } else {
            const kind = "too_many_pages" as const;
            const { onError, errorMessageFor } = optionsRef.current;
            const errMsg = errorMessageFor?.(kind) || materialIngestErrorCopy(kind);
            dispatch({ type: "UPLOAD_FAILED", kind, message: errMsg });
            onError?.(kind, errMsg, subjectIdRef.current);
          }
          break;
        }
        // Progress proves the bridge is alive — restart the watchdog.
        const currentRequestId = requestIdRef.current;
        if (currentRequestId && subjectIdRef.current) armParseTimer(currentRequestId, subjectIdRef.current);
        dispatch({ type: "PARSE_PROGRESS", page: msg.page, total: msg.total, routeKind: msg.routeKind });
        break;
      }
      case "fatal": {
        clearParseTimer();
        requestIdRef.current = null;
        dispatch({ type: "PARSE_FAILED", message: msg.message });
        const subjectId = subjectIdRef.current;
        if (subjectId) optionsRef.current.onError?.("invalid_pdf", msg.message, subjectId);
        break;
      }
      case "result":
        clearParseTimer();
        requestIdRef.current = null;
        dispatch({ type: "PARSE_DONE" });
        void createFuenteFromIngest(msg.result);
        break;
    }
  }

  const host = (
    <View style={{ height: 1, overflow: "hidden", position: "absolute" }}>
      <WebView
        ref={webviewRef}
        originWhitelist={["*"]}
        source={{ html: MATERIAL_INGEST_WEBVIEW_HTML, baseUrl: MATERIAL_INGEST_BASE_URL }}
        style={{ width: 300, height: 300 }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleWebviewMessage}
      />
    </View>
  );

  return {
    ingest,
    busy: isIngestBusy(ingest),
    startPick,
    cancel,
    reset,
    host,
  };
}
