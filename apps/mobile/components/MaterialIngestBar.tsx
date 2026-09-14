/**
 * Mid-session material ingestion — F2 WQ2 Part 2 + beta-real 07/08 feedback.
 *
 * Busy copy comes from `ingestStatusMessage` (same source as `isIngestBusy`).
 * Large PDFs skip the WebView and upload full for server classify.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useT } from "../i18n/react";
import { useTheme } from "../theme/useTheme";
import { radius, spacing, typography } from "../theme/tokens";
import { apiClient } from "../lib/api/expoClient";
import { ApiError } from "../lib/api/errors";
import { resolveClientUploadId } from "../lib/clientUploadId";
import { pickPdf } from "../lib/materialPicker";
import {
  buildSubsetUploadPlan,
  classifyIngestError,
  clientUploadModeForPageCount,
} from "../lib/materialIngest";
import { materialIngestErrorCopy } from "../lib/ingestErrorCopy";
import { hasMeasurableProgress, ingestProgressWidth, ingestStatusMessage } from "../lib/ingestStatusMessage";
import { WEBVIEW_PARSE_TIMEOUT_MS } from "../lib/materialIngestLimits";
import { parseWebToHostMessage, type IngestResult } from "../lib/materialIngestBridge";
import {
  IDLE_STATE,
  ingestReducer,
  isIngestAwaitingServer,
  isIngestBusy,
  type IngestState,
} from "../lib/materialIngestState";
import type { StudySession } from "../lib/api/types";
import { IngestCancelControl } from "./IngestCancelControl";

import {
  MATERIAL_INGEST_BASE_URL,
  MATERIAL_INGEST_WEBVIEW_HTML,
} from "../materials/generated/material-ingest-webview.generated";

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `ingest-${Date.now()}-${requestCounter}`;
}

export function MaterialIngestBar(props: {
  token: string;
  subjectId: string;
  session: StudySession;
  onSessionUpdated: (session: StudySession) => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const webviewRef = useRef<WebView>(null);
  const requestIdRef = useRef<string | null>(null);
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  /** When true, unmount must NOT abort — student chose "Dejar de esperar" (09 P2b). */
  const keepAliveRef = useRef(false);
  /** On-disk URI from the picker — needed when page count forces full upload mid-parse. */
  const pickedUriRef = useRef<string | null>(null);
  const pickedFileNameRef = useRef<string | null>(null);
  const pendingClientUploadIdRef = useRef<string | null>(null);
  const stateRef = useRef<IngestState>(IDLE_STATE);
  const [state, setState] = useState<IngestState>(IDLE_STATE);
  stateRef.current = state;

  function dispatch(action: Parameters<typeof ingestReducer>[1]) {
    setState((prev) => ingestReducer(prev, action));
  }

  function clearParseTimer() {
    if (parseTimerRef.current) {
      clearTimeout(parseTimerRef.current);
      parseTimerRef.current = null;
    }
  }

  function abortUpload() {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
  }

  /** Re-armed on EVERY progress message — a bridge that dies mid-parse hangs the same way. */
  function armParseTimer(requestId: string) {
    clearParseTimer();
    parseTimerRef.current = setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      requestIdRef.current = null;
      dispatch({ type: "PARSE_TIMEOUT", message: t.materialIngest.errors.timeout });
    }, WEBVIEW_PARSE_TIMEOUT_MS);
  }

  useEffect(() => {
    return () => {
      clearParseTimer();
      if (!keepAliveRef.current) abortUpload();
    };
  }, []);

  function cancel() {
    // Soft rescue (09 P2b): once the server is digesting, aborting only
    // discards the paid result. Leave the XHR alive and attach when it returns.
    if (isIngestAwaitingServer(stateRef.current)) {
      keepAliveRef.current = true;
      clearParseTimer();
      requestIdRef.current = null;
      dispatch({ type: "CANCEL" });
      return;
    }
    keepAliveRef.current = false;
    cancelledRef.current = true;
    clearParseTimer();
    abortUpload();
    requestIdRef.current = null;
    dispatch({ type: "CANCEL" });
  }

  async function startPick() {
    cancelledRef.current = false;
    keepAliveRef.current = false;
    clearParseTimer();
    abortUpload();
    pendingClientUploadIdRef.current = null;
    dispatch({ type: "PICK_STARTED" });
    let picked: Awaited<ReturnType<typeof pickPdf>>;
    try {
      picked = await pickPdf();
    } catch (err) {
      const { kind, message } = classifyIngestError(err);
      dispatch({ type: "PARSE_FAILED", message: materialIngestErrorCopy(kind, message) || message });
      return;
    }
    if (!picked) {
      dispatch({ type: "PICK_CANCELLED" });
      return;
    }
    if (cancelledRef.current) return;

    dispatch({ type: "FILE_PICKED", fileName: picked.fileName });
    pickedUriRef.current = picked.uri;
    pickedFileNameRef.current = picked.fileName;

    if (picked.base64 === null) {
      void uploadFullAndAttach(picked.fileName, picked.uri);
      return;
    }

    const requestId = nextRequestId();
    requestIdRef.current = requestId;
    armParseTimer(requestId);

    webviewRef.current?.postMessage(
      JSON.stringify({ type: "ingest", requestId, fileName: picked.fileName, pdfBase64: picked.base64 }),
    );
  }

  async function uploadFullAndAttach(fileName: string, fileUri: string) {
    dispatch({ type: "UPLOAD_STARTED" });
    const clientUploadId = resolveClientUploadId(pendingClientUploadIdRef.current);
    pendingClientUploadIdRef.current = clientUploadId;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    let materialId: string;
    try {
      const material = await apiClient.uploadMaterialFull(
        props.token,
        { subjectId: props.subjectId, fileName, fileUri, clientUploadId },
        {
          signal: controller.signal,
          onUploadProgress: (ratio) => {
            if (!cancelledRef.current) dispatch({ type: "UPLOAD_PROGRESS", ratio });
          },
          onUploadWaiting: () => {
            if (!cancelledRef.current) dispatch({ type: "UPLOAD_WAITING" });
          },
        },
      );
      pendingClientUploadIdRef.current = null;
      materialId = material.id;
    } catch (err) {
      if (cancelledRef.current) return;
      if (err instanceof ApiError && err.code === "duplicate_material") {
        // Mid-session bar has no reconcile overlay — treat as soft success:
        // session attach may still be needed on a later focus path.
        pendingClientUploadIdRef.current = null;
        dispatch({ type: "UPLOAD_WAITING" });
        return;
      }
      const { kind, message } = classifyIngestError(err);
      dispatch({ type: "UPLOAD_FAILED", kind, message: materialIngestErrorCopy(kind, message) || message });
      return;
    } finally {
      uploadAbortRef.current = null;
    }

    if (cancelledRef.current) return;
    dispatch({ type: "ATTACH_STARTED" });
    try {
      const updatedSession = await apiClient.attachMaterialToSession(props.token, props.session.id, materialId);
      if (cancelledRef.current) return;
      dispatch({ type: "ATTACH_SUCCEEDED", materialId });
      props.onSessionUpdated(updatedSession);
    } catch (err) {
      if (cancelledRef.current) return;
      const { kind, message } = classifyIngestError(err);
      dispatch({ type: "ATTACH_FAILED", kind, message: materialIngestErrorCopy(kind, message) || message });
    }
  }

  async function uploadAndAttach(result: IngestResult) {
    if (clientUploadModeForPageCount(result.totalPages) === "full") {
      const uri = pickedUriRef.current;
      if (!uri) {
        const kind = "too_many_pages" as const;
        dispatch({ type: "UPLOAD_FAILED", kind, message: materialIngestErrorCopy(kind) });
        return;
      }
      void uploadFullAndAttach(result.fileName, uri);
      return;
    }

    dispatch({ type: "UPLOAD_STARTED" });
    const clientUploadId = resolveClientUploadId(pendingClientUploadIdRef.current);
    pendingClientUploadIdRef.current = clientUploadId;
    const plan = { ...buildSubsetUploadPlan(props.subjectId, result), clientUploadId };
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    let materialId: string;
    try {
      const material = await apiClient.uploadMaterialSubset(props.token, plan, {
        signal: controller.signal,
        onUploadProgress: (ratio) => {
          if (!cancelledRef.current) dispatch({ type: "UPLOAD_PROGRESS", ratio });
        },
        onUploadWaiting: () => {
          if (!cancelledRef.current) dispatch({ type: "UPLOAD_WAITING" });
        },
      });
      pendingClientUploadIdRef.current = null;
      materialId = material.id;
    } catch (err) {
      if (cancelledRef.current) return;
      if (err instanceof ApiError && err.code === "duplicate_material") {
        pendingClientUploadIdRef.current = null;
        dispatch({ type: "UPLOAD_WAITING" });
        return;
      }
      const { kind, message } = classifyIngestError(err);
      dispatch({
        type: "UPLOAD_FAILED",
        kind,
        message: materialIngestErrorCopy(kind, message) || message,
      });
      return;
    } finally {
      uploadAbortRef.current = null;
    }

    if (cancelledRef.current) return;
    dispatch({ type: "ATTACH_STARTED" });
    try {
      const updatedSession = await apiClient.attachMaterialToSession(props.token, props.session.id, materialId);
      if (cancelledRef.current) return;
      dispatch({ type: "ATTACH_SUCCEEDED", materialId });
      props.onSessionUpdated(updatedSession);
    } catch (err) {
      if (cancelledRef.current) return;
      const { kind, message } = classifyIngestError(err);
      dispatch({
        type: "ATTACH_FAILED",
        kind,
        message: materialIngestErrorCopy(kind, message) || message,
      });
    }
  }

  function handleMessage(event: WebViewMessageEvent) {
    const msg = parseWebToHostMessage(event.nativeEvent.data);
    if (!msg || msg.requestId !== requestIdRef.current) return;
    switch (msg.type) {
      case "progress": {
        // Page count over subset cap → stop parsing early and upload whole PDF.
        if (clientUploadModeForPageCount(msg.total) === "full") {
          clearParseTimer();
          requestIdRef.current = null;
          const uri = pickedUriRef.current;
          const fileName = pickedFileNameRef.current ?? "documento.pdf";
          if (uri) {
            void uploadFullAndAttach(fileName, uri);
          } else {
            const kind = "too_many_pages" as const;
            dispatch({ type: "UPLOAD_FAILED", kind, message: materialIngestErrorCopy(kind) });
          }
          break;
        }
        const currentRequestId = requestIdRef.current;
        if (currentRequestId) armParseTimer(currentRequestId);
        dispatch({ type: "PARSE_PROGRESS", page: msg.page, total: msg.total, routeKind: msg.routeKind });
        break;
      }
      case "fatal":
        clearParseTimer();
        requestIdRef.current = null;
        dispatch({ type: "PARSE_FAILED", message: msg.message });
        break;
      case "result":
        clearParseTimer();
        requestIdRef.current = null;
        dispatch({ type: "PARSE_DONE" });
        void uploadAndAttach(msg.result);
        break;
    }
  }

  const busy = isIngestBusy(state);
  const measurable = hasMeasurableProgress(state);
  const showSpinner = busy && !measurable;

  return (
    <View>
      <View style={{ height: 1, overflow: "hidden" }}>
        <WebView
          ref={webviewRef}
          originWhitelist={["*"]}
          source={{ html: MATERIAL_INGEST_WEBVIEW_HTML, baseUrl: MATERIAL_INGEST_BASE_URL }}
          style={{ width: 300, height: 300 }}
          javaScriptEnabled
          domStorageEnabled
          onMessage={handleMessage}
        />
      </View>

      {state.phase === "idle" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.materialIngest.uploadButtonA11yLabel}
          onPress={() => void startPick()}
          style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}
        >
          <Text style={{ color: colors.accent, fontSize: typography.small.fontSize, fontWeight: typography.weights.semibold }}>
            {t.materialIngest.uploadButton}
          </Text>
        </Pressable>
      ) : null}

      {busy ? (
        <View
          style={{
            marginHorizontal: spacing.lg,
            marginBottom: spacing.sm,
            padding: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceRaised,
            borderWidth: 1,
            borderColor: colors.border,
            gap: spacing.xs,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {showSpinner ? <ActivityIndicator color={colors.accent} /> : null}
            <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: typography.caption.fontSize, flex: 1 }}>
              {ingestStatusMessage(state)}
            </Text>
          </View>
          {measurable ? (
            <View style={{ height: 2, backgroundColor: colors.border, borderRadius: 1 }}>
              <View
                style={{
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: colors.accent,
                  width: ingestProgressWidth(state),
                }}
              />
            </View>
          ) : null}
          <IngestCancelControl state={state} onPress={cancel} />
        </View>
      ) : null}

      {state.phase === "done" ? (
        <View
          style={{
            marginHorizontal: spacing.lg,
            marginBottom: spacing.sm,
            padding: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceRaised,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: colors.success, fontSize: typography.caption.fontSize, flexShrink: 1 }}>{t.materialIngest.done}</Text>
          <Pressable accessibilityRole="button" onPress={() => dispatch({ type: "DISMISS" })}>
            <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize }}>{t.materialIngest.dismiss}</Text>
          </Pressable>
        </View>
      ) : null}

      {state.phase === "error" && state.error ? (
        <View
          style={{
            marginHorizontal: spacing.lg,
            marginBottom: spacing.sm,
            padding: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: colors.dangerBg,
            gap: spacing.xs,
          }}
        >
          <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: typography.caption.fontSize }}>
            {state.error.message ||
              materialIngestErrorCopy(state.error.kind === "cancelled" ? "unknown" : state.error.kind, state.error.message)}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <Pressable accessibilityRole="button" onPress={() => void startPick()}>
              <Text style={{ color: colors.accent, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
                {t.materialIngest.retry}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => dispatch({ type: "DISMISS" })}>
              <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize }}>{t.materialIngest.dismiss}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
