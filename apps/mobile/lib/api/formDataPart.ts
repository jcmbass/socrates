/**
 * Multipart file parts for React Native's `FormData` + `XMLHttpRequest`.
 *
 * WHY THIS EXISTS — a real on-device failure (beta-real 08, moto e13):
 * every source upload died in under a second with "No se pudo subir la
 * fuente. Revisá tu conexión.", without a single byte leaving the phone.
 *
 * RN builds each multipart part with an OWN-property spread:
 *
 *   return {...value, headers, fieldName: name};   // Libraries/Network/FormData.js
 *
 * An `expo-file-system` `File` is a native class whose `uri`, `name` and
 * `type` are PROTOTYPE getters, not own enumerable properties. Spreading
 * one yields `{}` — the part reaches the native networking module with no
 * `uri`, the body can't be built, and `xhr.onerror` fires immediately. The
 * error is reported as a network failure, so the message blames the
 * student's connection for a bug that never touched the network.
 *
 * `expo/fetch` understands `File` natively, which is why every other
 * request in the app kept working. This bites ONLY the XHR upload path
 * (introduced by beta-real 07 Parte C for byte-level progress).
 *
 * So: hand RN what it documents — "an object with a `uri` attribute",
 * optionally `name` and `type` — as plain own properties.
 */

/** A multipart part shaped the way RN's `getParts()` can actually read. */
export interface RnFilePart {
  uri: string;
  name: string;
  type: string;
}

/** Part for a PDF living at `uri` on disk, presented to the server as `fileName`. */
export function pdfFormPart(uri: string, fileName: string): RnFilePart {
  return { uri, name: fileName, type: "application/pdf" };
}
