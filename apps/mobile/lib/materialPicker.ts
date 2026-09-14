/**
 * PDF document picker — F2 WQ2 Part 2. Kept in its own module so nothing
 * vitest touches imports `expo-document-picker`/`expo-file-system` (same
 * discipline as `lib/asyncStorageLocalStore.ts`'s docblock: the unit suite
 * runs under node, this binding is exercised by the `expo export` bundling
 * gate and, later, on-device — F2 WQ2 Part 3).
 *
 * beta-real 08: for PDFs above `CLIENT_WEBVIEW_MAX_BYTES`, do NOT read
 * base64 into JS — that alone (plus postMessage) OOMs low-RAM phones.
 * Return the on-disk URI so the host can upload the whole file for
 * server-side classify (`digestMaterialPdf`).
 */
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";

import { CLIENT_WEBVIEW_MAX_BYTES, shouldSkipWebViewParse } from "./materialIngestLimits";

export interface PickedPdf {
  fileName: string;
  /** On-disk URI (cache copy from the picker) — preferred upload source for large files. */
  uri: string;
  /** Binary size in bytes when known (DocumentPicker `asset.size`). */
  sizeBytes: number;
  /**
   * Full base64 for the WebView bridge, or `null` when the file must skip
   * on-device parse (size over the WebView threshold).
   */
  base64: string | null;
}

/** null = the student cancelled the picker (not an error — `materialIngestState.ts`'s PICK_CANCELLED). */
export async function pickPdf(): Promise<PickedPdf | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;

  const sizeBytes = typeof asset.size === "number" && asset.size > 0 ? asset.size : 0;

  // Large PDF: never load ~20 MB of base64 into the JS heap / WebView bridge.
  if (sizeBytes > 0 && shouldSkipWebViewParse(sizeBytes)) {
    return { fileName: asset.name, uri: asset.uri, sizeBytes, base64: null };
  }

  const file = new File(asset.uri);
  const base64 = await file.base64();
  // Defense when `asset.size` was missing/zero: estimate from base64 length.
  const estimatedBytes = Math.floor((base64.length * 3) / 4);
  const resolvedSize = sizeBytes > 0 ? sizeBytes : estimatedBytes;
  if (shouldSkipWebViewParse(resolvedSize)) {
    return { fileName: asset.name, uri: asset.uri, sizeBytes: resolvedSize, base64: null };
  }

  return { fileName: asset.name, uri: asset.uri, sizeBytes: resolvedSize, base64 };
}

/** Re-export for callers that only need the threshold check. */
export { CLIENT_WEBVIEW_MAX_BYTES, shouldSkipWebViewParse };
