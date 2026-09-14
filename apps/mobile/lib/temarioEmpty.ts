/**
 * Beta-real 06: "sin temario" y "temario con cero temas" son el mismo
 * estado para el estudiante. Helpers puros para la pantalla del árbol.
 */
import type { Fuente, Temario } from "./api/types";

/** True when there is nothing to study — missing row OR empty shell left by a failed generate. */
export function isTemarioEffectivelyEmpty(temario: Temario | null | undefined): boolean {
  if (temario == null) return true;
  return temario.topics.length === 0 && temario.milestones.length === 0;
}

/**
 * After a failed generate the Fuente survives on the server but
 * `pendingFuente` in memory is gone. Prefer the most recently created
 * Fuente so "Reintentar generación" works across app restarts.
 */
export function pickRetryFuente(fuentes: readonly Fuente[]): Fuente | null {
  if (fuentes.length === 0) return null;
  return [...fuentes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
