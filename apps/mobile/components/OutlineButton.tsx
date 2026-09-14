/**
 * Botón secundario: mismo cuerpo que `PrimaryButton` pero el acento vive en
 * el label y el contenedor es solo borde (`colors.border`) sobre
 * `surfaceRaised`. DESIGN.md §4 (bloques con bordes definidos, sin sombras),
 * `radius.md`, altura mínima `MIN_TOUCH_TARGET`.
 *
 * Vive acá y no dentro de una pantalla porque es vocabulario del sistema de
 * diseño: la primera vez apareció en la bienvenida del login ("Ya tengo
 * cuenta"), y una copia local se habría duplicado en el segundo uso.
 * `PressableScale` aporta el feedback de prensado (§6, con reduce-motion ya
 * resuelto ahí dentro).
 */
import { Text } from "react-native";

import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { PressableScale } from "./PressableScale";

export function OutlineButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const disabled = props.disabled ?? false;
  return (
    <PressableScale
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.accentLight : colors.surfaceRaised,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text
        style={{
          color: disabled ? colors.muted : colors.accent,
          fontSize: typography.body.fontSize,
          lineHeight: typography.body.lineHeight,
          letterSpacing: typography.body.letterSpacing,
          fontWeight: typography.weights.semibold,
          fontFamily: typography.fontFamily.semibold,
        }}
      >
        {props.label}
      </Text>
    </PressableScale>
  );
}
