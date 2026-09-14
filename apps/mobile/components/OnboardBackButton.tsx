/**
 * Discrete in-page "atrás" control for onboarding steps that have a
 * previous step to return to (paso 2 -> paso 1, paso 3 -> paso 2). Paso 1
 * is the start of the flow and never renders one.
 *
 * Maps `assets/onboard-paso-2-materias.html` / `onboard-paso-3-temario.html`'s
 * `.back-btn` (a 36x36 arrow square left of the progress dots) onto DESIGN
 * tokens instead of the maqueta's glass/mockup-blue square
 * (`rgba(255,255,255,0.07)` bg, `#c8e4ff` glyph) — `surfaceRaised`/`border`/
 * `foreground` here. Sized to `MIN_TOUCH_TARGET` (48dp, this project's
 * actual floor per `theme/tokens.ts`), well above DESIGN.md §8's 44px
 * absolute minimum. The glyph is `BackArrowIcon` (svgrepo left-arrow) —
 * before 2026-08-06 it was the "‹" text character.
 *
 * Craft spec §2.5 (D1): press feedback via `PressableScale`.
 */
import { useT } from "../i18n/react";
import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius } from "../theme/tokens";
import { BackArrowIcon } from "./icons/BackArrowIcon";
import { PressableScale } from "./PressableScale";

export function OnboardBackButton(props: { onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityLabel={t.common.back}
      onPress={props.onPress}
      style={({ pressed }) => ({
        width: MIN_TOUCH_TARGET,
        height: MIN_TOUCH_TARGET,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.accentLight : colors.surfaceRaised,
      })}
    >
      <BackArrowIcon size={20} color={colors.foreground} />
    </PressableScale>
  );
}
