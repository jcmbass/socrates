/**
 * Guardia del pulso del orbe de procesamiento.
 *
 * Vive acá y no dentro de `components/ThinkingOrb.tsx` por una razón medida:
 * el arquitecto mutó la condición equivalente DENTRO del `useEffect` del
 * componente (2026-08-02) y los 345 tests siguieron en verde. La suite de
 * `apps/mobile` corre en entorno Node y solo incluye módulos PUROS
 * (`lib/`, `theme/`, `plugins/`), así que nada que importe React Native es
 * testeable — la guardia quedaba fuera de alcance por construcción.
 *
 * Importa que esté cubierta: el `GlowRing` con pulso permanente midió
 * **100% de jank** en el Motorola e13 (gama baja, 1.87 GB), y este orbe vive
 * en un encabezado SIEMPRE visible. Animar en reposo repetiría ese fallo.
 */
export function shouldRunOrbPulse(active: boolean, reduceMotion: boolean): boolean {
  return active && !reduceMotion;
}
