/**
 * ColdStartGate — estado de espera "Despertando a Socrates…" para la primera
 * petición tras inactividad del server (Render free tier + Neon cold start
 * puede tomar >120s, D1 midió >120s).
 *
 * **apple-design skill §3-4**: feedback inmediato (se muestra en cuanto se
 * inicia la petición), animación de opacidad con spring críticamente
 * amortiguado (damping 1.0, response 0.4), interrumpible por diseño (los
 * springs de RN arrancan desde el valor actual). `useReduceMotion` desactiva
 * la animación (skill §14).
 *
 * **DESIGN.md §5**: el avatar `socrates-contemplating` está reservado para
 * estados de espera/reflexión — es exactamente el que usamos aquí.
 *
 * El componente es puramente visual: no maneja lógica de red ni estado de
 * carga. El caller controla `visible` y `retrying`.
 */
import { useEffect, useState } from "react";
import { Animated, Text, View } from "react-native";

import { useT } from "../i18n/react";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { spacing, typography } from "../theme/tokens";
import { TutorAvatar } from "./TutorAvatar";

interface ColdStartGateProps {
  /** Whether the gate is visible (a cold-start request is in flight). */
  visible: boolean;
  /** Whether this is a retry (second attempt after first timeout). */
  retrying?: boolean;
}

export function ColdStartGate({ visible, retrying = false }: ColdStartGateProps) {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  // Spring animation for the container opacity — apple-design skill §3-4:
  // critically damped, interruptible. Lazy state initializer (same pattern as
  // ThinkingDots.tsx and StreakDisplay.tsx).
  const [opacityAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      opacityAnim.setValue(visible ? 1 : 0);
      return;
    }
    if (visible) {
      // Fade in with a critically-damped spring — no overshoot.
      Animated.spring(opacityAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
        restSpeedThreshold: 0.5,
        restDisplacementThreshold: 0.5,
      }).start();
    } else {
      // Fade out immediately (no lingering).
      opacityAnim.setValue(0);
    }
  }, [visible, reduceMotion, opacityAnim]);

  if (!visible) return null;

  return (
    <Animated.View
      accessible
      accessibilityLabel={t.coldStart.title}
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.lg,
        padding: spacing.xl,
        opacity: opacityAnim,
      }}
    >
      {/* Avatar contemplativo — DESIGN.md §5: reserved for waiting states. */}
      <TutorAvatar variant="contemplating" size={64} />

      <View style={{ gap: spacing.xs, alignItems: "center" }}>
        <Text
          style={{
            color: colors.foreground,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
            fontWeight: typography.weights.semibold,
            fontFamily: typography.fontFamily.semibold,
            textAlign: "center",
          }}
        >
          {t.coldStart.title}
        </Text>
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.small.fontSize,
            lineHeight: typography.small.lineHeight,
            fontFamily: typography.fontFamily.regular,
            textAlign: "center",
          }}
        >
          {retrying ? t.coldStart.retrying : t.coldStart.subtitle}
        </Text>
      </View>
    </Animated.View>
  );
}
