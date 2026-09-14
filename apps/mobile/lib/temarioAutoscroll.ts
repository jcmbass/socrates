/**
 * Autoscroll de entrada del temario — decisión PURA de "¿a qué offset hay que
 * scrollear, si es que hay que scrollear?" (`app/subjects/[subjectId]/
 * temario.tsx`, 2026-08-06).
 *
 * Vive fuera del componente por la misma razón que `skillTreeRail.ts`: es
 * aritmética de layout, la parte más propensa a driftear en silencio cuando
 * alguien toca el pitch, el padding o el anclaje — y la única forma de tener
 * una guardia real es poder ejercerla bajo vitest.
 *
 * Convención de coordenadas: `recommendedCenterY` viene relativo a la RAÍZ de
 * `SkillTree` (lo reporta `onRecommendedCenterY`), y `contentTopPadding` es lo
 * que hay entre el inicio del contenido scrolleable y esa raíz — hoy el
 * `padding` del `contentContainerStyle`, porque SkillTree es su primer hijo.
 */

export interface AutoScrollTargetInput {
  /** Y del centro del nodo recomendado, relativa a la raíz de SkillTree.
   *  `null` cuando no hay recomendado (todo done, o temario sin temas). */
  recommendedCenterY: number | null;
  /** Offset entre el inicio del contenido scrolleable y la raíz de SkillTree. */
  contentTopPadding: number;
  /** Alto visible del ScrollView. Ya excluye al CTA fijo: el CTA es hermano
   *  del ScrollView en una columna flex, no un overlay. */
  viewportHeight: number;
  /** Alto total del contenido scrolleable (`onContentSizeChange`). */
  contentHeight: number;
  /** Scroll actual. Si el estudiante ya se movió por su cuenta, no lo pisamos. */
  currentScrollY: number;
  /**
   * Dónde queda el nodo dentro del viewport, como fracción desde arriba.
   * 0.5 = centro geométrico exacto. Ver `temarioAutoscroll.viewportAnchor`.
   */
  viewportAnchor: number;
  /** Si el estudiante ya scrolleó más que esto, se cancela el autoscroll. */
  studentScrollTolerance: number;
  /** Recorrido mínimo que justifica animar; por debajo no vale la pena. */
  minTravel: number;
}

/**
 * Devuelve el offset destino, o `null` cuando NO hay que autoscrollear.
 * Las salidas tempranas, en orden:
 *  1. no hay tema recomendado;
 *  2. todavía no hay medidas (viewport/contenido en 0);
 *  3. el contenido cabe entero en pantalla (no hay scroll posible);
 *  4. el estudiante ya scrolleó por su cuenta;
 *  5. el recorrido resultante es despreciable (el recomendado ya está donde
 *     lo dejaríamos).
 */
export function resolveAutoScrollTarget(input: AutoScrollTargetInput): number | null {
  const {
    recommendedCenterY,
    contentTopPadding,
    viewportHeight,
    contentHeight,
    currentScrollY,
    viewportAnchor,
    studentScrollTolerance,
    minTravel,
  } = input;

  if (recommendedCenterY === null) return null;
  if (viewportHeight <= 0 || contentHeight <= 0) return null;

  const maxOffset = contentHeight - viewportHeight;
  if (maxOffset <= 0) return null;

  if (currentScrollY > studentScrollTolerance) return null;

  const desired = contentTopPadding + recommendedCenterY - viewportHeight * viewportAnchor;
  const target = Math.min(Math.max(desired, 0), maxOffset);

  if (Math.abs(target - currentScrollY) < minTravel) return null;

  return target;
}
