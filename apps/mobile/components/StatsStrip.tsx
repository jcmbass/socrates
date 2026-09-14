/**
 * StatsStrip — D2 (craft spec §3 home item 2): racha + XP como una fila
 * compacta y discreta sobre `surfaceRaised`, reemplazando los dos chips
 * sueltos que `app/courses/index.tsx` renderizaba antes (`StreakDisplay` +
 * `XpBadge`, cada uno con su propia píldora flotante). Ambos siguen siendo
 * los dueños de su propio contenido/lógica (spring bump, degradación
 * antifuga) — este componente solo los hospeda en `variant="bare"` (sin su
 * píldora individual) dentro de UNA superficie compartida, para no anidar
 * píldora-dentro-de-píldora.
 *
 * Degrada limpio: si no hay racha visible (streak null/"none" sin datos aún)
 * y XP no es visible (shadow mode o carga fallida), no renderiza nada — el
 * home no debe mostrar una tira vacía.
 *
 * **D2 fix (arquitecto REVIEW, 2026-07-22): XP clippeado a 390px.** La
 * frase de racha vacía ("Todavía no hay racha — cada explicación cuenta")
 * ocupaba todo el ancho del strip y empujaba el badge de XP fuera del
 * borde derecho (visible solo un borde de "0" en el edge del viewport).
 * Fix de dos partes: (1) `StreakDisplay.tsx` ahora trunca su texto con
 * `numberOfLines={1}`+`flexShrink:1` en `variant="bare"` (ver el fix
 * documentado en ese módulo); (2) acá, el wrapper de `StreakDisplay` recibe
 * `flex: 1, minWidth: 0` (toma el espacio disponible y SÍ puede encogerse
 * por debajo de su ancho de contenido — `minWidth: 0` es necesario
 * específicamente en react-native-web, donde el default CSS de un flex
 * item es `min-width: auto`, que de otro modo bloquea el shrink) y el
 * wrapper de `XpBadge` recibe `flexShrink: 0` — el XP NUNCA se encoge ni se
 * corta, siempre queda completo, anclado al borde derecho del strip.
 */
import { View } from "react-native";

import { StreakDisplay } from "./StreakDisplay";
import { XpBadge } from "./XpBadge";
import type { StreakResult } from "../lib/api/types";
import type { XpDisplay } from "../lib/homeCards";
import { useTheme } from "../theme/useTheme";
import { radius, spacing } from "../theme/tokens";

export interface StatsStripProps {
  streak: StreakResult | null;
  xp: XpDisplay;
}

export function StatsStrip({ streak, xp }: StatsStripProps) {
  const { colors } = useTheme();

  // Matches StreakDisplay's own null-render condition exactly (`state ===
  // "none" && !streak`, i.e. only when `streak` itself is falsy/loading) —
  // a real streak of 0/0 still has text to show ("Todavía no hay racha"),
  // so it must NOT be treated as "nothing to render" here.
  if (streak === null && !xp.visible) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: colors.surfaceRaised,
        borderWidth: 1,
        borderColor: colors.border,
        gap: spacing.md,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <StreakDisplay streak={streak} variant="bare" />
      </View>
      {xp.visible ? (
        <View style={{ flexShrink: 0 }}>
          <XpBadge visible total={xp.total} variant="bare" />
        </View>
      ) : null}
    </View>
  );
}
