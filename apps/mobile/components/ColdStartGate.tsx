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
 * **Espera viva (hallazgo E de la beta cerrada):** la espera es real y larga,
 * así que la pantalla no puede quedarse quieta. Tres puntos en loop (mismo
 * patrón native-driver que `ThinkingDots`; el avatar NO se anima, DESIGN.md
 * §6) y una frase de arranque (`coldStart.bootLines`) que rota cada
 * `BOOT_LINE_MS` bajo el subtítulo honesto, que nunca se reemplaza. Con
 * reduce-motion: ni loop ni rotación — título + subtítulo, estáticos.
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

const DOT_COUNT = 3;
const DOT_CYCLE_MS = 1400;
const BOOT_LINE_MS = 3500;
const BOOT_LINE_FADE_MS = 250;

export function ColdStartGate({ visible, retrying = false }: ColdStartGateProps) {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const animate = visible && !reduceMotion;

  // Spring animation for the container opacity — apple-design skill §3-4:
  // critically damped, interruptible. Lazy state initializer (same pattern as
  // ThinkingDots.tsx and StreakDisplay.tsx).
  const [opacityAnim] = useState(() => new Animated.Value(0));
  const [dots] = useState(() => Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.25)));
  const [lineOpacity] = useState(() => new Animated.Value(1));
  const [lineIndex, setLineIndex] = useState(0);
  const bootLines = t.coldStart.bootLines;

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

  useEffect(() => {
    if (!animate) return;
    const loops = dots.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((i * DOT_CYCLE_MS) / DOT_COUNT),
          Animated.timing(value, { toValue: 1, duration: DOT_CYCLE_MS / 2, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.25, duration: DOT_CYCLE_MS / 2, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [animate, dots]);

  useEffect(() => {
    if (!animate || bootLines.length < 2) return;
    const interval = setInterval(() => {
      Animated.timing(lineOpacity, { toValue: 0, duration: BOOT_LINE_FADE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setLineIndex((i) => (i + 1) % bootLines.length);
        Animated.timing(lineOpacity, { toValue: 1, duration: BOOT_LINE_FADE_MS, useNativeDriver: true }).start();
      });
    }, BOOT_LINE_MS);
    return () => {
      clearInterval(interval);
      lineOpacity.stopAnimation();
      lineOpacity.setValue(1);
    };
  }, [animate, bootLines.length, lineOpacity]);

  if (!visible) return null;

  const bootLine = bootLines[lineIndex % bootLines.length] ?? null;

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

      {animate ? (
        <View style={{ gap: spacing.sm, alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: spacing.xs, alignItems: "center" }}>
            {dots.map((value, i) => (
              <Animated.View
                key={i}
                style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, opacity: value }}
              />
            ))}
          </View>
          {bootLine ? (
            <Animated.Text
              style={{
                opacity: lineOpacity,
                color: colors.accent,
                fontSize: typography.small.fontSize,
                lineHeight: typography.small.lineHeight,
                fontFamily: typography.fontFamily.regular,
                textAlign: "center",
              }}
            >
              {bootLine}
            </Animated.Text>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}
