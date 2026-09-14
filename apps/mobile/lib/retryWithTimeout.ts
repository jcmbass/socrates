/**
 * Cold-start tolerance helpers — timeout + retry for the FIRST request after
 * app start (or after server inactivity). The Render free tier + Neon cold
 * start can take >120s (D1 measured >120s without HTTP response), so the
 * default timeout is generous (180s) and a single automatic retry handles the
 * case where the first attempt timed out while the server was still waking up.
 *
 * PURE (no react-native import) — testable under plain vitest/node, same
 * discipline as lib/streak.ts.
 */

/** Default timeout for the first request after inactivity (180 seconds). */
export const COLD_START_TIMEOUT_MS = 180_000;

/** Default timeout for subsequent (warm) requests (30 seconds). */
export const WARM_TIMEOUT_MS = 30_000;

/**
 * Create an AbortSignal that aborts after `ms` milliseconds.
 * Returns `undefined` when ms is 0 or negative (no timeout).
 */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  if (ms <= 0) return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
  return controller.signal;
}

/**
 * Fetch with a timeout. Wraps the given `fetchImpl` (so it works with both
 * the global `fetch` in tests and `expo/fetch` in production) and rejects
 * with a `TimeoutError`-named DOMException if the request takes longer than
 * `timeoutMs`.
 *
 * The caller's `init.signal` (if any) is COMBINED with the timeout signal via
 * an internal controller — either the timeout OR the caller's abort triggers
 * rejection, and the other signal is cleaned up.
 */
export async function fetchWithTimeout<R>(
  fetchImpl: (url: string, init?: RequestInit) => Promise<R>,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = COLD_START_TIMEOUT_MS,
): Promise<R> {
  if (timeoutMs <= 0) {
    return fetchImpl(url, init);
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new DOMException("Timeout", "TimeoutError"));
  }, timeoutMs);

  // Combine the caller's signal (if any) with the timeout signal.
  // RequestInit.signal is `AbortSignal | null`; normalize null to undefined.
  const callerSignal = init.signal ?? undefined;
  const combinedSignal = combineSignals(callerSignal, timeoutController.signal);

  try {
    const response = await fetchImpl(url, { ...init, signal: combinedSignal });
    return response;
  } finally {
    clearTimeout(timeoutId);
    // If the caller's signal was the one that fired, the timeout signal is
    // irrelevant — clean it up.
    if (!timeoutController.signal.aborted) {
      // No-op: the timeout didn't fire, we're done.
    }
  }
}

/**
 * Métodos donde reintentar es seguro: no cambian estado en el servidor, así
 * que repetirlos no puede duplicar nada.
 *
 * `undefined` es GET (default de fetch).
 */
export function isRetrySafeMethod(method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}

/**
 * Fetch with cold-start retry: tries once with `timeoutMs`, and if that
 * rejects with a TimeoutError, retries ONCE — **pero solo si el método es
 * seguro de repetir** (`isRetrySafeMethod`).
 *
 * POR QUÉ ESA RESTRICCIÓN — bug reportado por el founder el 2026-07-29:
 * mandó un mensaje al tutor, esperó minutos, vio "revisá tu conexión", y al
 * volver a entrar al tema encontró **su mensaje enviado, respondido, y
 * repetido**, con el tutor señalando que se repetía.
 *
 * Causa: `POST /v1/sessions/:id/exchanges` **no es idempotente** — hace hablar
 * al tutor y persiste un Exchange. Un timeout del cliente NO cancela el
 * trabajo del servidor, así que este reintento automático mandaba el mismo
 * mensaje de nuevo: doble gasto de modelo y, peor, **la transcripción
 * pedagógica corrompida** (el tutor cree que el estudiante se repite).
 *
 * El reintento existe para el arranque en frío de Render (>120 s). Eso lo
 * resuelve igual de bien un GET, que es lo que la app hace primero al abrir.
 * Un POST que se pasó de tiempo puede haber tenido efecto: la única respuesta
 * honesta es informarlo, no repetirlo a ciegas.
 *
 * Los demás casos pasan sin reintento igual que antes: errores de red,
 * respuestas 4xx/5xx y abortos del llamador.
 */
export async function fetchWithColdStartRetry<R>(
  fetchImpl: (url: string, init?: RequestInit) => Promise<R>,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = COLD_START_TIMEOUT_MS,
): Promise<R> {
  try {
    return await fetchWithTimeout(fetchImpl, url, init, timeoutMs);
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    // Un POST/PATCH/DELETE que se pasó de tiempo puede haber cambiado estado.
    // Repetirlo duplica; propagar el timeout es la única opción honesta.
    if (!isRetrySafeMethod(init.method)) throw err;
    // First attempt timed out — retry once (server may have been waking up).
    return fetchWithTimeout(fetchImpl, url, init, timeoutMs);
  }
}

/**
 * Check if an error is a timeout (DOMException with name "TimeoutError").
 * This is the standard browser/Node timeout signal abort reason.
 */
export function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    err.name === "TimeoutError"
  );
}

/**
 * Combine two AbortSignals into one. If either signal aborts, the combined
 * signal aborts with the same reason. Cleans up the listener on the caller's
 * signal when the combined signal resolves.
 *
 * Returns the non-undefined signal if only one is provided, or undefined if
 * both are undefined.
 */
function combineSignals(
  a: AbortSignal | undefined,
  b: AbortSignal,
): AbortSignal {
  if (!a) return b;
  if (a.aborted) return a;

  const controller = new AbortController();

  const onAbort = () => {
    const reason = a.aborted ? a.reason : b.reason;
    controller.abort(reason);
  };

  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });

  // If the combined signal is aborted (by either source), clean up the
  // listener on the other source to avoid leaks.
  controller.signal.addEventListener("abort", () => {
    a.removeEventListener("abort", onAbort);
    b.removeEventListener("abort", onAbort);
  }, { once: true });

  return controller.signal;
}
