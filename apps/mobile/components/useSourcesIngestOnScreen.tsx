/**
 * Screen-owned Fuentes ingest: pick → process with modal closed → pill shows
 * progress. Host (WebView) stays on the screen, not inside the Modal — so
 * closing the sheet cannot tear down the pipeline.
 *
 * Also reconciles materials on focus / app-active (server is the durable
 * record). Sees `digesting` (still working) vs ready/partial (attach Fuente)
 * vs failed — the founder misunderstanding this closes. Never re-uploads.
 * See `lib/reconcileOrphanMaterials.ts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFocusEffect } from "expo-router";

import { apiClient } from "../lib/api/expoClient";
import { fuentesIngestErrorCopy, reconcileDigestFailedError } from "../lib/ingestErrorCopy";
import { classifyIngestError } from "../lib/materialIngest";
import { IDLE_STATE, isIngestBusy, type IngestState } from "../lib/materialIngestState";
import { reconcileOrphanMaterials } from "../lib/reconcileOrphanMaterials";
import { useIngestToFuente } from "./useIngestToFuente";

/** While the overlay shows server-side digesting, re-ask on this cadence. */
const DIGESTING_POLL_MS = 15_000;

export function useSourcesIngestOnScreen(options: {
  token: string;
  subjectId: string;
  onFuenteAttached: () => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  /** Overlay for server-side recovery — drives the same Fuentes pill. */
  const [reconcileIngest, setReconcileIngest] = useState<IngestState | null>(null);
  const reconcileInFlightRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runReconcileRef = useRef<() => Promise<void>>(async () => {});
  /** True while overlay reflects an in-flight server digest (allows re-poll). */
  const watchingDigestingRef = useRef(false);

  const ingestApi = useIngestToFuente({
    token: options.token,
    errorMessageFor: (kind) => fuentesIngestErrorCopy(kind),
    onFilePicked: () => {
      // Founder: close Sources as soon as the student chooses the PDF.
      setSourcesOpen(false);
    },
    onFuente: () => {
      options.onFuenteAttached();
    },
    onDuplicateMaterial: () => {
      // Same spirit as duplicate_turn: adopt server state, never re-upload.
      void runReconcileRef.current();
    },
  });

  const liveIngestRef = useRef(ingestApi.ingest);
  liveIngestRef.current = ingestApi.ingest;
  const reconcileIngestRef = useRef(reconcileIngest);
  reconcileIngestRef.current = reconcileIngest;

  const runReconcile = useCallback(async () => {
    const { token, subjectId, onFuenteAttached } = optionsRef.current;
    if (!token || !subjectId) return;
    // Never interrupt a live pick/upload, and never overlap reconciles.
    if (isIngestBusy(liveIngestRef.current) || reconcileInFlightRef.current) return;
    // Allow re-check while watching server digesting; block only while attaching.
    const overlay = reconcileIngestRef.current;
    if (overlay && isIngestBusy(overlay) && !watchingDigestingRef.current) return;

    reconcileInFlightRef.current = true;
    try {
      const result = await reconcileOrphanMaterials(apiClient, token, subjectId, {
        onDigesting: (material) => {
          watchingDigestingRef.current = true;
          setReconcileIngest({
            ...IDLE_STATE,
            phase: "processing",
            fileName: material.originalFilename?.trim() || "PDF",
          });
        },
        onAttachStart: (fileName) => {
          watchingDigestingRef.current = false;
          setReconcileIngest({
            ...IDLE_STATE,
            phase: "reconciling",
            fileName,
          });
        },
        onAttached: async () => {
          onFuenteAttached();
        },
        onFailed: (material) => {
          watchingDigestingRef.current = false;
          const fileName = material.originalFilename?.trim() || "PDF";
          const digestError = reconcileDigestFailedError();
          setReconcileIngest({
            ...IDLE_STATE,
            phase: "error",
            fileName,
            error: digestError,
          });
        },
      });

      if (!result.ok) {
        watchingDigestingRef.current = false;
        const { kind, message } = classifyIngestError(result.error);
        const msg = fuentesIngestErrorCopy(kind) || message;
        setReconcileIngest({
          ...IDLE_STATE,
          phase: "error",
          error: { kind, message: msg },
        });
        return;
      }

      if (result.digesting.length > 0) {
        // Overlay already set via onDigesting; keep watching.
        return;
      }

      if (result.attached.length > 0) {
        watchingDigestingRef.current = false;
        setReconcileIngest(null);
        return;
      }

      if (result.failed.length > 0) {
        // Overlay already set via onFailed.
        return;
      }

      // Nothing to do — stay quiet (no pill noise).
      watchingDigestingRef.current = false;
      setReconcileIngest(null);
    } finally {
      reconcileInFlightRef.current = false;
    }
  }, []);

  runReconcileRef.current = runReconcile;

  // Same pattern as `courses/index.tsx`: ask the server when the screen
  // regains focus — no local cache of half-finished ingest.
  useFocusEffect(
    useCallback(() => {
      void runReconcile();
    }, [runReconcile]),
  );

  // App came back to foreground (OS may have killed the request; server work
  // may have finished). No keep-awake — founder decision.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "active") void runReconcile();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [runReconcile]);

  // Lightweight poll while we know the server is still digesting — GET only.
  useEffect(() => {
    if (!watchingDigestingRef.current && reconcileIngest?.phase !== "processing") return;
    const timer = setInterval(() => {
      if (watchingDigestingRef.current) void runReconcile();
    }, DIGESTING_POLL_MS);
    return () => clearInterval(timer);
  }, [reconcileIngest?.phase, runReconcile]);

  const ingest = reconcileIngest ?? ingestApi.ingest;

  return {
    sourcesOpen,
    setSourcesOpen,
    ...ingestApi,
    ingest,
    busy: isIngestBusy(ingest),
  };
}
