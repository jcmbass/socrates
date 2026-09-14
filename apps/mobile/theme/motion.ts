/**
 * Vocabulario único de movimiento (craft spec `docs/plan-diseno-craft/00-craft-spec.md`
 * §2.3). Regla dura desde D1: **ninguna pantalla ni componente define
 * constantes de spring/duración propias** — todo el mundo importa de acá.
 * (`GlowRing`, en `components/SkillTree.tsx`, sigue con su `Animated` core
 * ad-hoc hoy — está fuera de alcance de D1, D3 lo migra.)
 *
 * Deliberadamente SIN import de `react-native`/`react-native-reanimated` en
 * este módulo: igual que `theme/tokens.ts`, debe seguir siendo TS puro para
 * poder testearse bajo vitest/node (`vitest.config.ts` solo cubre
 * `theme/__tests__/**`, nada que importe react-native). Los presets son
 * datos planos + una función pura; la aplicación real (worklets,
 * `Easing.out(...)`) vive en los componentes que consumen este módulo
 * (p.ej. `components/PressableScale.tsx`), donde SÍ hay runtime RN.
 *
 * Los valores de damping/response son la traducción directa de la tabla de
 * Apple que trae la skill apple-design (§4): un spring "crítico" (sin
 * overshoot) usa dampingRatio 1.0; el único rebote permitido en toda la app
 * es el de sheets/drawers (dampingRatio ~0.8) porque ahí SÍ hay momentum
 * percibido por el usuario (arrastre/flick) — en cualquier otro lugar,
 * rebotar sin que el usuario haya imprimido movimiento se siente como un
 * error, no como física.
 */

/** Config estructural compatible con `WithSpringConfig` de reanimated 4
 * (rama `{ duration, dampingRatio }`) sin importar el paquete acá. */
export interface SpringPreset {
  readonly duration: number;
  readonly dampingRatio: number;
}

export const springs = {
  /** Default de UI: crítico, sin overshoot (Apple damping 1.0 / response 0.4).
   * Úsalo para cualquier transición de estado que no sea presión ni sheet:
   * entradas escalonadas, barras de progreso, fades de habilitado/deshabilitado. */
  settle: { duration: 400, dampingRatio: 1.0 } satisfies SpringPreset,
  /** Sheets/drawers: leve rebote SOLO porque hay momentum percibido (Apple
   * 0.8/0.3 — el usuario arrastró o soltó con velocidad). El ÚNICO preset
   * con overshoot en toda la app. */
  sheet: { duration: 300, dampingRatio: 0.8 } satisfies SpringPreset,
  /** Micro-interacciones (soltar una presión, toggles): crítico y rápido —
   * `PressableScale` lo usa en `pressOut`. */
  snap: { duration: 250, dampingRatio: 1.0 } satisfies SpringPreset,
} as const;

/**
 * Timing de la RESPUESTA en pointer-down (skill apple-design §1: el control
 * debe reaccionar en down, no esperar al release). Instantáneo y sin
 * physics — es un `withTiming`, no un spring; el spring vive del lado del
 * release (`springs.snap`). El valor de easing ("ease-out") se aplica en el
 * componente consumidor con `Easing.out(Easing.ease)` de reanimated (no se
 * importa acá, ver nota de módulo).
 */
export const pressTiming = { duration: 100 } as const;

/**
 * Timing compartido para crossfades de ESTADO (no de presión): enabled<->
 * disabled (`PrimaryButton`), foco/blur (`TextField`), vacío<->con-texto
 * del botón enviar (`ChatComposer`) — la spec §2.5 pide "150ms" para las
 * tres, así que es un solo número acá en vez de tres literales `{ duration:
 * 150 }` repetidos por componente.
 */
export const crossfadeTiming = { duration: 150 } as const;

export type SpringName = keyof typeof springs;

/**
 * `GlowRing` cadence (`components/SkillTree.tsx`, D3 craft spec §4.1): the
 * recommended-node pulse — 2.2s full cycle (1.1s per leg, opacity 0.35↔0.6
 * at the call site). This is the one continuous DECORATIVE loop in the app
 * (it breathes regardless of user action or app state, unlike every preset
 * above which responds to a state transition) — exported here anyway so no
 * component defines its own animation-duration literal (the D1 rule this
 * module's header states), even for a one-off ambient loop.
 */
export const glowPulse = { halfCycleDuration: 1100 } as const;

/**
 * Header `ThinkingOrb` pulse while a Fuente PDF is ingesting (opacity-only,
 * same worklet discipline as `GlowRing`). Faster than the decorative tree
 * glow — this one signals active work, not ambient recommendation.
 * Full cycle 1.6s (0.8s per leg).
 */
export const orbPulse = { halfCycleDuration: 800 } as const;

/**
 * `GlowRing` scroll-pause fallback debounce (device-e13 finding: the pulse
 * composited over a scrolling list cost half the frames on low-end
 * hardware — see DEVLOG "experimento de control del jank del árbol"). The
 * PRIMARY signal for "scroll terminó" is `onMomentumEnd` on the tree's
 * `Animated.ScrollView` (`app/subjects/[subjectId]/temario.tsx`) — it
 * resolves instantly for the common drag+fling gesture. This debounce is
 * only the FALLBACK: a short drag can end (`onEndDrag`) with no residual
 * velocity, so no `onMomentumBegin`/`onMomentumEnd` pair ever fires; this
 * timer (started on `onEndDrag`, cancelled by `onBeginDrag`/`onMomentumBegin`
 * if a real gesture follows) guarantees the glow still resumes. 200ms
 * comfortably bridges the native gap between `onEndDrag` and a following
 * `onMomentumBegin` without being perceptible as a delay once the user has
 * actually stopped.
 */
export const glowScrollPauseDebounce = { duration: 200 } as const;

/**
 * Autoscroll de entrada del temario (`app/subjects/[subjectId]/temario.tsx`,
 * 2026-08-06): la pantalla abre arriba, espera `delayMs` (suficiente para
 * que la entrada escalonada del árbol arranque y el estudiante registre la
 * ruta completa) y luego scrollea sola hasta centrar el tema recomendado.
 * DESIGN.md §6: es una revelación guiada, no una transición de estado de
 * cada día, así que el conjunto delay+travel puede pasar del techo de 0.6s.
 * Bajo reduce-motion el salto es instantáneo (`animated: false`) — mismo
 * estado final, sin recorrido vestibular.
 *
 * `travelMs`: duración del recorrido, animado frame a frame con
 * `withTiming` + easing "elevador" (ease-in-out cubic: arranque lento,
 * crucero, desaceleración fuerte al llegar — pedido del founder 2026-08-06).
 * El EASING vive en el componente (`Easing.inOut(Easing.cubic)`) porque
 * este módulo no puede importar reanimated (ver nota de cabecera) — misma
 * división que `pressTiming`. La curva nativa de `scrollTo(animated: true)`
 * no es configurable, por eso el offset lo conduce un shared value.
 */
/**
 * `viewportAnchor`: fracción del viewport, desde arriba, donde aterriza el
 * nodo recomendado. 0.5 sería el centro geométrico exacto; lo dejamos un
 * pelo MÁS ABAJO a propósito. El árbol se dibuja de abajo hacia arriba
 * (`orderForBottomUpDisplay`), así que lo que está ARRIBA del recomendado es
 * el camino que le falta y lo de abajo es lo ya hecho: bajar el nodo revela
 * más futuro y menos pasado. Ponerlo en 0.5 vuelve al centro exacto.
 */
export const temarioAutoscroll = { delayMs: 600, travelMs: 1200, viewportAnchor: 0.56 } as const;

/**
 * Helper mínimo: bajo reduce-motion, ninguna pantalla/componente debe
 * decidir por su cuenta si anima o no — llaman acá con el valor "con
 * movimiento" y el valor "estático" y este devuelve el que corresponde.
 * Pura, sin dependencias — trivialmente testeable.
 */
export function motionOrStatic<T>(reduceMotion: boolean, motionValue: T, staticValue: T): T {
  return reduceMotion ? staticValue : motionValue;
}

/**
 * DESVÍO documentado respecto a la spec §2.3: el bloque de referencia
 * sugiere reexportar `useReduceMotion` desde acá ("para no duplicar"). NO
 * se hizo — `theme/useTheme.ts` importa `AccessibilityInfo` de
 * `react-native`, y un `export { useReduceMotion } from "./useTheme"` aquí
 * arrastra esa importación al grafo de módulos de `motion.ts` COMPLETO
 * (ESM no hace tree-shaking en dev/test, solo en el bundle final) — hasta
 * un test que solo importe `motionOrStatic`/`springs` termina evaluando
 * `react-native/index.js`, que usa sintaxis Flow que el parser de
 * vitest/rolldown no entiende (falla con "Flow is not supported"),
 * exactamente lo que este módulo existe para evitar (ver nota de arriba:
 * "deliberadamente SIN import de react-native"). Los consumidores
 * (`components/PressableScale.tsx`, etc.) importan `useReduceMotion`
 * directo de `theme/useTheme` — un import más, pero mantiene `motion.ts`
 * puro/testeable, que es la propiedad que la spec pedía preservar en
 * primer lugar.
 */
