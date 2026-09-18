/**
 * Punto de entrada de MATERIAL DE ESTUDIO a nivel materia (obs. 2a de la
 * beta cerrada, `docs/plan-beta-real/11-observaciones-beta-cerrada.md`).
 *
 * Hasta ahora subir un PDF solo era alcanzable desde adentro de un tema o
 * de un hito (el clip del composer / la píldora "Fuentes" del chat), o
 * desde el estado vacío del temario. Dos testers no lo encontraron, y los
 * logs de producción muestran casi todas las sesiones con `fuenteCount: 0`.
 * La pantalla de temario — la que se abre con UN toque desde home — ahora
 * lleva la misma píldora "Fuentes" + `SourcesModal` que ya usan los chats.
 *
 * Este módulo es la decisión pura de CUÁNDO esa entrada está activa. Vive
 * acá (y no inline en la pantalla) por la misma razón que
 * `temarioAutoscroll.ts` / `temarioEmpty.ts`: el suite de `apps/mobile`
 * corre en node y no monta react-native, así que la lógica que se puede
 * equivocar tiene que ser testeable fuera de la pantalla.
 */

export type SubjectSourcesEntryInput = {
  /** Primer fetch del temario en vuelo. */
  loading: boolean;
  /** El fetch falló — la pantalla muestra "Reintentar", no el árbol. */
  error: boolean;
  /** `isTemarioEffectivelyEmpty(temario)` — fila ausente o cáscara sin temas. */
  temarioEmpty: boolean;
  /** Corre el flujo "Subir PDF → armar temario" del estado vacío. */
  buildingTemario: boolean;
  /** El editor manual de temas ocupa la pantalla completa. */
  editing: boolean;
};

/**
 * La entrada de material a nivel materia se muestra SOLO cuando la
 * pantalla está mostrando el árbol de verdad.
 *
 * Se apaga a propósito mientras el temario está vacío o armándose: ese
 * estado ya tiene su propio "Subir PDF" (`EmptyNoTemario`), que además
 * hace algo DISTINTO con el PDF (genera el temario, no solo adjunta una
 * fuente). Dos botones de subir con consecuencias distintas en la misma
 * pantalla serían una trampa, no descubribilidad.
 */
export function isSubjectSourcesEntryActive(input: SubjectSourcesEntryInput): boolean {
  if (input.loading || input.error) return false;
  if (input.buildingTemario) return false;
  if (input.temarioEmpty) return false;
  if (input.editing) return false;
  return true;
}

/**
 * `subjectId` que ve `useSourcesIngestOnScreen`. Devolver `""` apaga su
 * reconcile de huérfanos (el hook hace `if (!token || !subjectId) return`).
 *
 * Esto NO es cosmético: mientras corre el flujo del estado vacío, esa
 * pantalla sube un material y adjunta la Fuente ella misma. Un reconcile
 * en paralelo podría ver el mismo material como huérfano en la ventana
 * entre "material listo" y `attachSource`, y adjuntar una segunda Fuente
 * con el mismo texto. Apagarlo mientras la otra máquina manda cierra esa
 * carrera sin tocar el hook compartido.
 */
export function sourcesReconcileSubjectId(subjectId: string | undefined, active: boolean): string {
  if (!active) return "";
  return subjectId ?? "";
}
