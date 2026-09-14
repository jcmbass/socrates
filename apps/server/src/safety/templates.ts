/**
 * Static crisis/refusal replies — C-backend §0 decision 8 / §3.2 point 2:
 * "el mensaje de crisis es una plantilla estática, nunca generada por el
 * modelo." The exact text/resource is explicitly NOT fixed by the spec
 * (§3.2: "el texto exacto y el recurso citado no lo fija esta spec —
 * necesita verificación legal/de contenido real antes de la beta", risk
 * R-C4) — swapping in a legally-reviewed final text is a content change to
 * this one file, not a code change.
 *
 * 2026-07-26, antes de la beta con estudiantes reales: `CRISIS_REPLY` traía
 * anexado un bloque `[NOTA F1/WP5: … placeholder …]` con una referencia
 * interna a la spec. **Se mostraba VERBATIM al estudiante**, o sea que
 * alguien que acabara de revelar autolesión o abuso leía una nota de
 * ingeniería al pie del mensaje de contención — el peor momento posible.
 * Eliminado. Lo que queda es texto de contención sobrio y el 911 de El
 * Salvador, que es verificable.
 *
 * **2026-07-28 — R-C4 CERRADA en cuanto al recurso.** El founder aportó las
 * líneas oficiales de atención de El Salvador y quedan incorporadas:
 *
 *   - ISSS Te Escucha: 7071-1302 (24/7) y 2591-6557 (L-V 7:00-15:30).
 *     Atiende a toda la población, no solo cotizantes.
 *   - Ministerio de Salud: 131, opción 4.
 *   - Línea 126 (ISDEMU): 24/7, para mujeres y adolescentes.
 *
 * Los números vienen del founder, NO de una búsqueda del asistente: un
 * teléfono equivocado en este mensaje es peor que no dar ninguno. Si alguno
 * cambia, se actualiza ACÁ y en ningún otro lado.
 *
 * Nota de redacción: la Línea 126 se presenta explícitamente como dirigida a
 * mujeres y adolescentes, que es su mandato real — no como línea general.
 * Presentarla de otro modo mandaría a parte de los estudiantes a un recurso
 * que no les corresponde, justo cuando menos margen tienen para averiguarlo.
 */
import type { SafetyCategory } from "./classifier";
import { normalizePreferredLanguageCode } from "../locale";

export const CRISIS_REPLY = `Gracias por confiar en mí para contarme esto — lo que compartiste es serio y quiero que sepas que no estás solo/a. No puedo continuar con la sesión de estudio en este momento, pero sí quiero ayudarte a encontrar apoyo real.

Si estás en peligro inmediato, llamá al 911 o acudí a la sala de emergencias más cercana.

También hay líneas de atención gratuitas en El Salvador donde te puede escuchar un profesional:

• ISSS Te Escucha — 7071-1302, las 24 horas, todos los días. También al 2591-6557 de lunes a viernes, de 7:00 a.m. a 3:30 p.m. Atienden a toda la población, no solo a cotizantes.
• Ministerio de Salud — marcá 131 y elegí la opción 4.
• Línea 126 (ISDEMU) — atención 24/7 para mujeres y adolescentes, con apoyo psicológico y asesoría legal.

Y por favor contale a un adulto de confianza — un familiar, un maestro o un consejero — lo antes posible.`;

/**
 * A3a (AJUSTE 3) — versión en inglés del mismo mensaje. Traduce SOLO el
 * texto envolvente, con criterio y no mecánicamente: los RECURSOS son los
 * mismos, byte por byte (911; ISSS Te Escucha 7071-1302 y 2591-6557;
 * MINSA 131 opción 4; Línea 126). No existen "recursos equivalentes en
 * inglés" para un estudiante en El Salvador — darle otros teléfonos aquí
 * sería inventar números en el peor momento posible, exactamente lo que el
 * blockquote de arriba prohíbe. Los nombres propios de las líneas
 * (ISSS Te Escucha, Línea 126, ISDEMU) quedan en español porque ASÍ
 * contestan el teléfono; "Ministerio de Salud" se abre como "Ministry of
 * Health" para el lector y conserva el "option 4" del IVR real.
 */
export const CRISIS_REPLY_EN = `Thank you for trusting me with this — what you shared is serious, and I want you to know you are not alone. I can't continue with the study session right now, but I do want to help you find real support.

If you are in immediate danger, call 911 or go to the nearest emergency room.

There are also free helplines in El Salvador where a professional can listen to you:

• ISSS Te Escucha — 7071-1302, 24 hours a day, every day. Also 2591-6557, Monday to Friday, 7:00 a.m. to 3:30 p.m. They serve everyone, not only insured contributors.
• Ministry of Health (Ministerio de Salud) — dial 131 and choose option 4.
• Línea 126 (ISDEMU) — 24/7 support for women and teenagers, with psychological counseling and legal advice.

And please tell a trusted adult — a family member, a teacher, or a school counselor — as soon as you can.`;

export const JAILBREAK_REFUSAL_REPLY = `Soy tu tutor y solo puedo ayudarte con lo que estás estudiando ahora mismo. No puedo cambiar de rol ni ignorar cómo funciono, pero con gusto seguimos con el ejercicio en el que estábamos.`;

export const JAILBREAK_REFUSAL_REPLY_EN = `I'm your tutor and I can only help you with what you're studying right now. I can't switch roles or ignore how I work, but I'm happy to keep going with the exercise we were on.`;

/**
 * El idioma de la respuesta estática sigue al usuario
 * (`users.preferredLanguageCode`, ya cargado por `requireAuth`+`findUserById`
 * en sessions.ts). Default "es": es lo que TODOS recibían antes de A3a y lo
 * que recibe quien aún no sincronizó locale — no-regresión garantizada.
 */
export function staticReplyFor(
  category: Exclude<SafetyCategory, "none">,
  locale: string | null | undefined = "es",
): string {
  const resolved = normalizePreferredLanguageCode(locale);
  switch (category) {
    case "self_harm":
    case "abuse_disclosure":
      return resolved === "en" ? CRISIS_REPLY_EN : CRISIS_REPLY;
    case "jailbreak_attempt":
    case "other":
      return resolved === "en" ? JAILBREAK_REFUSAL_REPLY_EN : JAILBREAK_REFUSAL_REPLY;
  }
}
