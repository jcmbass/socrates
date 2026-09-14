/**
 * Rutas legales PÚBLICAS (sin auth): el enlace que toca el estudiante junto a
 * la casilla "Acepto los términos" antes de tener cuenta. Por eso van montadas
 * arriba del middleware de `/v1/*` — un documento legal que exige estar
 * logueado para leerlo no cumple su función.
 *
 * `Cache-Control: no-store` a propósito: si corregimos una cláusula, nadie
 * debe seguir viendo la anterior desde una caché intermedia.
 */
import { Hono } from "hono";

import { DELETE_ACCOUNT_HTML, PRIVACY_HTML, TERMS_HTML } from "../legal/documents";

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

export function createLegalRoutes(): Hono {
  const app = new Hono();

  app.get("/terminos", (c) => c.html(TERMS_HTML, 200, HEADERS));
  app.get("/privacidad", (c) => c.html(PRIVACY_HTML, 200, HEADERS));
  app.get("/eliminar-cuenta", (c) => c.html(DELETE_ACCOUNT_HTML, 200, HEADERS));

  return app;
}
