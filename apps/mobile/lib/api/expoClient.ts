/**
 * Production wiring: the REAL `expo/fetch` (DF-5.2 — RN's built-in `fetch`
 * has only partial response-streaming support) plugged into the pure
 * `createApiClient` (client.ts). Kept in its own module so nothing vitest
 * touches imports `expo/fetch` — same pattern as
 * `lib/asyncStorageLocalStore.ts` for `@react-native-async-storage`; this
 * binding is exercised by the `expo export` bundling gate and on-device
 * (F1/WP6 Part 3), not by the unit suite.
 *
 * F2 WQ2 Part 2 fix: `createApiClient.uploadMaterialSubset` builds the
 * request from base64 strings using the web-standard `Blob` constructor so
 * the pure client stays testable under Node. On the real RN runtime,
 * `expo/fetch` + React Native's `FormData` do NOT reliably accept a JS
 * `Blob` for file fields (the body either goes empty or the server rejects it
 * as malformed multipart). The production client therefore overrides
 * `uploadMaterialSubset` to materialize each cloud-page base64 into a real
 * on-disk file via `expo-file-system` and then append an Expo `File` object,
 * which streams as binary multipart — verified on the moto e13.
 *
 * beta-real 07/08: materials upload uses XMLHttpRequest (upload.onprogress +
 * upload.onload) so the UI can show a real progress bar while bytes leave
 * the device, then a filename spinner while the server digests. Timeout is
 * `MATERIALS_UPLOAD_TIMEOUT_MS`. Full-PDF mode skips the WebView for large
 * files (`uploadMaterialFull`).
 */
import { fetch as expoFetch } from "expo/fetch";
import { writeAsStringAsync, cacheDirectory } from "expo-file-system/legacy";

import {
  createApiClient,
  type ApiFetch,
  type ApiFetchResponse,
  type FullUploadPlan,
  type UploadMaterialFullOptions,
  type UploadMaterialSubsetOptions,
} from "./client";
import type { SubsetUploadPlan } from "../materialIngest";
import type { MaterialAsset } from "./types";
import { pdfFormPart } from "./formDataPart";
import { uploadProgressUpdate } from "./uploadProgress";
import { API_BASE_URL } from "./config";
import { ApiError } from "./errors";
import { fetchWithColdStartRetry } from "../retryWithTimeout";
import { MATERIALS_UPLOAD_TIMEOUT_MS } from "../materialIngestLimits";

/**
 * Wraps the real `expo/fetch` with cold-start tolerance: 180s timeout on
 * every request, with a single automatic retry if the first attempt times out
 * (the server may have been waking from Render free-tier sleep + Neon cold
 * start, which D1 measured at >120s).
 */
const fetchWithRetry: ApiFetch = (url, init) =>
  fetchWithColdStartRetry<ApiFetchResponse>(expoFetch as unknown as ApiFetch, url, init);

const baseClient = createApiClient({
  baseUrl: API_BASE_URL,
  // expo/fetch's FetchResponse satisfies ApiFetchResponse structurally
  // (ok/status/json/text/body) — see client.ts's module doc.
  fetchImpl: fetchWithRetry,
});

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Multipart materials upload with real byte progress via XHR.
 * `expo/fetch` does not expose upload progress; XHR's `upload.onprogress`
 * does, and RN FormData accepts Expo `File` fields the same way.
 */
function uploadFormWithProgress(
  token: string,
  form: FormData,
  opts?: UploadMaterialSubsetOptions,
): Promise<MaterialAsset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let waitingNotified = false;
    let settled = false;

    const notifyWaiting = () => {
      if (waitingNotified) return;
      waitingNotified = true;
      opts?.onUploadWaiting?.();
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const timer = setTimeout(() => {
      xhr.abort();
      settle(() => reject(new ApiError("network_error", "Materials upload timed out", null)));
    }, MATERIALS_UPLOAD_TIMEOUT_MS);

    const onAbort = () => {
      xhr.abort();
      settle(() => reject(new ApiError("network_error", "Materials upload cancelled", null)));
    };
    if (opts?.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.open("POST", `${API_BASE_URL}/v1/materials`);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const update = uploadProgressUpdate(event.loaded, event.total);
      if (!update) return;
      opts?.onUploadProgress?.(update.ratio);
      // RN never dispatches `load` on `xhr.upload` — this 100% progress event
      // is the ONLY signal that the body finished leaving the device. Without
      // it the UI sits on "Subiendo… 100%" for the whole server digest.
      if (update.finished) notifyWaiting();
    };

    xhr.onerror = () => {
      settle(() => reject(new ApiError("network_error", "Network request failed", null)));
    };
    xhr.onabort = () => {
      settle(() => reject(new ApiError("network_error", "Materials upload cancelled", null)));
    };
    xhr.onload = () => {
      notifyWaiting();
      const status = xhr.status;
      const body = parseJsonSafe(xhr.responseText);
      settle(() => {
        if (status < 200 || status >= 300) {
          reject(ApiError.fromBody(body, status));
          return;
        }
        resolve(body as MaterialAsset);
      });
    };

    xhr.send(form);
  });
}

async function uploadMaterialSubset(
  token: string,
  plan: SubsetUploadPlan,
  opts?: UploadMaterialSubsetOptions,
): Promise<MaterialAsset> {
  const form = new FormData();
  form.append("subjectId", plan.subjectId);
  form.append("mode", "subset");
  form.append("totalPages", String(plan.totalPages));
  form.append("pages", plan.manifestJson);
  form.append("originalFilename", plan.originalFilename);
  if (plan.clientUploadId) form.append("clientUploadId", plan.clientUploadId);

  for (const file of plan.files) {
    const uri = `${cacheDirectory}ingest-${Date.now()}-${file.fieldName}.pdf`;
    await writeAsStringAsync(uri, file.base64, { encoding: "base64" });
    form.append(file.fieldName, pdfFormPart(uri, file.fileName) as unknown as Blob);
  }

  return uploadFormWithProgress(token, form, opts);
}

async function uploadMaterialFull(
  token: string,
  plan: FullUploadPlan,
  opts?: UploadMaterialFullOptions,
): Promise<MaterialAsset> {
  const form = new FormData();
  form.append("subjectId", plan.subjectId);
  if (plan.clientUploadId) form.append("clientUploadId", plan.clientUploadId);

  if (plan.fileUri) {
    // Stream from disk — never re-encode a large PDF through base64 in JS.
    form.append("file", pdfFormPart(plan.fileUri, plan.fileName) as unknown as Blob);
  } else if (plan.base64) {
    const uri = `${cacheDirectory}ingest-full-${Date.now()}.pdf`;
    await writeAsStringAsync(uri, plan.base64, { encoding: "base64" });
    form.append("file", pdfFormPart(uri, plan.fileName) as unknown as Blob);
  } else {
    throw new ApiError("invalid_request", "uploadMaterialFull requires fileUri or base64", 400);
  }

  return uploadFormWithProgress(token, form, opts);
}

export const apiClient = {
  ...baseClient,
  uploadMaterialSubset,
  uploadMaterialFull,
};
