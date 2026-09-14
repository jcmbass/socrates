/**
 * URLs de los documentos legales publicados. Los sirve el propio servidor
 * (`apps/server/src/routes/legal.ts`, rutas públicas sin auth) y no una
 * pantalla dentro de la app, a propósito: así una corrección a una cláusula
 * sale con un deploy y no obliga a recompilar y redistribuir el APK.
 *
 * Cuelgan de `API_BASE_URL` — el mismo origen que ya usa el cliente — para
 * que apunten solos al servidor correcto en dev, en el harness local y en
 * producción, sin una constante nueva que se pueda desincronizar.
 */
import { API_BASE_URL } from "./api/config";

/** Quita la barra final para no generar `…//legal/terminos`. */
function origin(): string {
  return API_BASE_URL.replace(/\/+$/, "");
}

export function termsUrl(): string {
  return `${origin()}/legal/terminos`;
}

export function privacyUrl(): string {
  return `${origin()}/legal/privacidad`;
}
