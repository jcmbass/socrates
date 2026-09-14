/**
 * ¿El turno que "falló" en realidad llegó?
 *
 * POR QUÉ EXISTE — bug reportado por el founder el 2026-07-29: mandó un
 * mensaje al tutor, esperó minutos, vio "revisá tu conexión", apretó
 * Reintentar, y al volver a entrar al tema encontró **su mensaje enviado,
 * respondido, y repetido**, con el tutor señalando que se repetía.
 *
 * La raíz: `POST /v1/sessions/:id/exchanges` no es idempotente y **un timeout
 * del cliente no cancela el trabajo del servidor**. El tutor ya habló y el
 * Exchange ya quedó guardado; el cliente simplemente dejó de escuchar.
 *
 * Reintentar a ciegas duplica: doble gasto de modelo y, peor, la
 * transcripción pedagógica corrompida. Antes de reenviar hay que **preguntarle
 * al servidor** — `getSession` es un GET, gratis y seguro de repetir.
 *
 * Esto NO reemplaza una clave de idempotencia del lado del servidor (la única
 * defensa completa: cierra también la ventana entre el chequeo y el reenvío).
 * Es la mitigación que se puede tener hoy sin migración de esquema.
 *
 * beta-real 10: el servidor ahora reclama `clientMessageId` y responde
 * `409 duplicate_turn` ante un reenvío. Ese código también dispara
 * reconciliación por GET — no es un error rojo para el estudiante.
 */

export interface LandedTurnCandidate {
  studentMessage: string;
  tutorReply: string;
}

/**
 * El turno más reciente cuyo mensaje del estudiante coincide con `pending` y
 * que ya tiene respuesta del tutor. `null` si no llegó.
 *
 * Compara con `trim()` porque el servidor puede normalizar los bordes.
 * Requiere respuesta no vacía: un Exchange guardado sin respuesta no es un
 * turno completo y reenviarlo sí corresponde.
 */
export function findLandedTurn<T extends LandedTurnCandidate>(
  turns: readonly T[],
  pending: string,
): T | null {
  const target = pending.trim();
  if (target.length === 0) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn && turn.studentMessage.trim() === target && turn.tutorReply.trim().length > 0) {
      return turn;
    }
  }
  return null;
}

/**
 * ¿Vale preguntarle al servidor antes de reenviar?
 *
 * Solo para fallas de transporte, donde el pedido pudo haber llegado igual. Un
 * rechazo explícito del servidor (cuota, sesión cerrada, safety) NO dejó un
 * turno a medias, así que preguntar sería una llamada al vacío.
 */
export function shouldCheckIfTurnLanded(code: string | undefined): boolean {
  return (
    code === "network_error" ||
    code === "upstream_error" ||
    code === "internal_error" ||
    code === "duplicate_turn"
  );
}
