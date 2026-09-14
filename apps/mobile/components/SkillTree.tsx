/**
 * SkillTree — W3 rebuild of the "árbol de temas" (`assets/estudios.html`)
 * as a zigzag skill-tree/game map instead of the plain vertical stepper P4
 * shipped. Structure/feel taken from the mockup (zigzag left/right rows,
 * bigger glowing "recommended" node, connectors, per-topic cards with
 * stars) — palette is 100% `theme/tokens.ts` (the mockup's blue/gradient
 * palette is explicitly NOT the brand, per DESIGN.md).
 *
 * **DF-P02 navegación libre — THREE states, no lock:**
 * - `done`: `successBg` fill + `success` border/check + gold stars — a
 *   calm "logro guardado", not a shout (see D3 note below).
 * - `recommended` (`resolveRecommendedTopicId`): bigger node, pulsing
 *   accent glow ring — the ONLY "push"; no other node is ever dimmed,
 *   dashed, or padlocked to make this one look special by contrast.
 * - `available` (not done, not recommended): `elevated` fill/`border`
 *   stroke, fully tappable, no lock glyph, no "se desbloquea al terminar X"
 *   copy anywhere in this file. `lib/skillTree.ts` encodes `locked: false`
 *   in the DATA itself — there is no `locked` branch here to reintroduce.
 *
 * **Layout direction:** explicit at every call site. `gameMap` preserves
 * P4's bottom-up route for the flat tree; `syllabus` renders grouped
 * chapters in curricular top-down order so topic 1 appears first.
 *
 * **Zigzag:** every row alternates its card to the left/right of a fixed-
 * width center rail — each side is a `flex:1` slot, so the rail stays
 * exactly centered at any screen width, and whichever side holds the card
 * for this row fills that slot's full available width (see the card-width
 * note below for why "full width of the slot", not a fixed pixel guess).
 *
 * **Card width is `flex:1`/`minWidth:0` of its slot, not a fixed pixel cap**
 * (W3 clipping fix): the first pass used a fixed `maxWidth` tuned against a
 * 390px viewport, which overflowed the RIGHT-side slot at that same
 * viewport once the mockup's assumption ("this box always has room")
 * didn't hold — RN-Web's flexbox defaults a flex item's `min-width` to
 * `auto` (its content's natural width), so a card can refuse to shrink
 * below a long title's intrinsic width and spill past its slot/the screen
 * edge even with a `maxWidth` set. `flex:1` makes the card claim exactly
 * its slot's available width (screen width minus the rail and outer
 * padding) at ANY viewport, and the explicit `minWidth:0` overrides the
 * web default so the title `Text` is forced to wrap inside that width
 * instead of pushing the box wider. No screen-width math (no
 * `useWindowDimensions`) needed — flexbox does it for every width, not
 * just 360/390. **D3 does not touch this — still intact, still `flex:1`/
 * `minWidth:0` on both `TopicCard`/`MilestoneCard`.**
 *
 * **Rail (F1-F4):**
 * The old per-row `<View>` connectors produced uneven gaps because the
 * circle's vertical center depended on the card's variable height. F1
 * fixes this with a fixed row pitch (`ROW_PITCH = BASE_PITCH * fontScale`)
 * and title truncation to 2 lines. F2 extracts the geometry to a pure,
 * testable function in `lib/skillTreeRail.ts`. F3 replaces the N `<View>`
 * connectors with a single SVG `<Path>` (two layers: done + pending)
 * behind the rows. F4 curves the rail with cubic beziers, dashes the
 * pending segments, and adds a `success`→`border` gradient at the first
 * done→pending transition. The SVG sits behind the rows with
 * `pointerEvents="none"` so taps pass through to the rows.
 *
 * **Recommended glow** (apple-design skill): opacity-only pulse
 * (reanimated worklet, transform/opacity budget), ~2.2s cycle (0.35↔0.6).
 * `useReduceMotion` swaps it for a static mid-opacity ring — still visually
 * distinct, no vestibular motion.
 * **Paused while scrolling** (device-e13 finding, see DEVLOG "experimento de
 * control del jank del árbol del árbol"): re-compositing this ring every frame on top of
 * a scrolling list cost half the frames on low-end hardware (100% janky,
 * 3/3 runs, vs ~0% for the same list with the glow held static). The pulse
 * exists to INVITE a look at the recommended topic — while the student is
 * actively scrolling they're navigating, not contemplating, so the animation
 * earns nothing there and costs real frames. `temario.tsx` owns a
 * `isScrolling` reanimated `SharedValue<boolean>` (written by a
 * `useAnimatedScrollHandler` on the tree's `Animated.ScrollView`, entirely
 * on the UI thread — no React state, no re-renders) threaded down through
 * `SkillTree` → `TreeRow` → `TopicCircle` → `GlowRing` as a plain prop (the
 * shared value's identity never changes, so this costs nothing extra).
 * `GlowRing` reacts to it with `useAnimatedReaction` (UI thread): scrolling
 * ⇒ `cancelAnimation` + hold at `GLOW_STATIC_OPACITY` (the same constant
 * reduce-motion already uses); scroll ends ⇒ pulse resumes from
 * `GLOW_MIN_OPACITY`. Reduce-motion still wins unconditionally — see
 * `GlowRing`'s own doc.
 *
 * Milestones get a visually distinct DIAMOND badge (a 45°-rotated square
 * behind an upright glyph) instead of a circle, `warning` (gold) accented
 * — "hito", not "tema". No emoji glyphs anywhere (DESIGN.md: adult tone).
 *
 * **D3 (craft spec §4) — jerarquía de luz, conectores, entrada escalonada:**
 * - Reequilibrio de color: `done` pasó de `success` SÓLIDO (el nodo más
 *   ruidoso de la pantalla, diagnóstico spec §0 punto 2) a `successBg` +
 *   borde/check `success` — calmo. `available` pasó de `surfaceRaised` a
 *   `elevated` (un peldaño de profundidad por encima de la tarjeta que lo
 *   rodea, craft spec §2.1). SOLO `recommended` sigue brillando (fill
 *   `accent` + `GlowRing`) — la jerarquía que el spec pide.
 * - `GlowRing` migrado de `Animated` (core RN) a reanimated (worklets,
 *   consistente con `PressableScale`/D1 — el módulo de `theme/motion.ts`
 *   ya anotaba esta migración como pendiente de D3); techo de opacidad
 *   bajado de 0.75 a 0.6 (spec §4.1: "0.35↔0.6, sutil"); ciclo sigue en
 *   2.2s (1100ms cada tramo, sin cambios ahí).
 * - Conectores "done" ahora usan `success` SÓLIDO (antes tomaban prestado
 *   `accent`, el color del estado "recommended" — un tramo ya caminado no
 *   debería brillar como el próximo paso); grosor 2px (antes 3, spec §4.2:
 *   "grosor 2px consistente").
 * - Entrada escalonada (spec §4.4): cada `TreeRow` anima fade+rise 12dp con
 *   `springs.settle`, delay `index * 30ms` (orden de display, el mismo que
 *   ya usa `orderForBottomUpDisplay`). **Sin booleano `hasEntered`** (a
 *   diferencia de D2/home): `SkillTree` solo se monta UNA VEZ por visita
 *   real a la pantalla — el padre (`temario.tsx`) lo renderiza recién
 *   cuando `temario` deja de ser `null`, y no hay ningún `useFocusEffect`
 *   ahí que lo re-monte al volver con back (el stack navigator conserva la
 *   instancia). Un efecto de "solo montaje" (deps `[]`) por nodo alcanza
 *   para "una sola entrada" — no hace falta el estado React + workaround de
 *   eslint que D2 necesitó en Home (que sí persiste montado entre
 *   refetches por foco, un problema que este árbol no tiene). Costo: 26
 *   nodos × 2 `useSharedValue` (opacity/translateY), cada uno disparando UN
 *   `withDelay`+spring que corre una sola vez en el hilo de UI (reanimated
 *   worklet) — sin timers JS, sin trabajo por frame en steady-state; el
 *   único loop continuo de la pantalla sigue siendo `GlowRing`, acotado al
 *   nodo recomendado (uno solo, nunca 26).
 * - Presión: `TreeRow` migró de `Pressable` (RN core, dimming manual por
 *   opacidad) a `PressableScale` (D1) — nodo+tarjeta se comprimen juntos
 *   como una sola fila (siguen siendo un ÚNICO hit-target, decisión ya
 *   tomada en W3; partirlo en dos zonas de tap separadas no es parte de
 *   este cambio).
 * - Eyebrows (`TU RUTA DE APRENDIZAJE`, `INICIO DEL TEMARIO`, `TEMA N`/
 *   `Recomendado`, `PARCIAL`/`Examen final`) migrados a `typography.eyebrow`
 *   (D1 dejó esto explícitamente pendiente para este archivo).
 *
 * **Fix (post-D3 review, misma fase):** dos ajustes de ancho a 390dp.
 * (1) El badge "Recomendado" volvió a sentence-case/`caption` (NO
 * `typography.eyebrow`) — "RECOMENDADO" en mayúsculas + tracking 1.2
 * partía en 2 líneas dentro del ancho de la tarjeta; `TEMA N`/hitos, con
 * strings más cortos, conservan el eyebrow. (2) El padding horizontal de
 * `TopicCard`/`MilestoneCard` bajó de `spacing.sm` a `spacing.xs`, y el
 * padding horizontal del slot de cada lado en `TreeRow` también bajó a
 * `spacing.xs` (antes `spacing.sm` en ambos) — +16dp de ancho útil para el
 * texto por tarjeta (medido: 99px→115px de caja de texto a 390dp),
 * suficiente para que un título de una sola palabra sin espacio de corte
 * (p.ej. "Estequiometría", 14 caracteres) entre en una línea. Medido
 * directamente contra el DOM real (react-native-web) con el harness
 * `harness/web-local/` — NO es una corrección de `RAIL_WIDTH` (se
 * mantiene, es una decisión de W3 ligada al tamaño del nodo recomendado).
 */
import { useEffect } from "react";
import { PixelRatio, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, G, LinearGradient, Path, Stop } from "react-native-svg";

import { useT } from "../i18n/react";
import {
  buildSkillTreeNodes,
  formatSkillTreeCap,
  orderSkillTreeNodes,
  skillTreeChrome,
  type SkillTreeCapSlot,
  type SkillTreeNode,
  type SkillTreeOrder,
} from "../lib/skillTree";
import { BASE_PITCH, bezierSegmentD, buildRailGeometry, GLOW_EXTRA, nodeCenterY, nodeX, sideForIndex, splitRailByStatus } from "../lib/skillTreeRail";
import type { Temario } from "../lib/api/types";
import { glowPulse, springs } from "../theme/motion";
import { useReduceMotion, useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { PressableScale } from "./PressableScale";

const NODE_SIZE = MIN_TOUCH_TARGET;
const RECOMMENDED_NODE_SIZE = MIN_TOUCH_TARGET + 20;
const RAIL_WIDTH = RECOMMENDED_NODE_SIZE + 24;

/** Pending-segment dash pattern: 8dp dash + 6dp gap. */
const PENDING_DASHARRAY = "8,6";

/** GlowRing pulse (spec §4.1): cadence lives in `theme/motion.ts`'s `glowPulse`
 * (D1 rule: no component defines its own animation-duration constant) —
 * only the opacity range (0.35↔0.6), specific to THIS ring, stays local. */
const GLOW_MIN_OPACITY = 0.35;
const GLOW_MAX_OPACITY = 0.6;
const GLOW_STATIC_OPACITY = 0.5;

/** Tree entrance (spec §4.4): fade + rise 12dp, spring `settle`, 30ms/index stagger. */
const ENTRANCE_RISE_DP = 12;
const ENTRANCE_STAGGER_MS = 30;

type TopicNodeData = Extract<SkillTreeNode, { kind: "topic" }>;
type MilestoneNodeData = Extract<SkillTreeNode, { kind: "milestone" }>;

function Stars({ count }: { count: 0 | 1 | 2 | 3 }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View accessibilityLabel={t.skillTree.starsA11y(count)} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {[0, 1, 2].map((i) => (
        <Text
          key={i}
          style={{
            color: i < count ? colors.warning : colors.border,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
          }}
        >
          ★
        </Text>
      ))}
    </View>
  );
}

/** Starts (or restarts) the ping-pong pulse from `GLOW_MIN_OPACITY`. Marked
 * `"worklet"` so it can be called both from JS (mount effect) and from the
 * UI-thread `useAnimatedReaction` below without a `runOnJS` hop. */
function startGlowPulse(opacity: SharedValue<number>) {
  "worklet";
  opacity.value = GLOW_MIN_OPACITY;
  opacity.value = withRepeat(
    withTiming(GLOW_MAX_OPACITY, { duration: glowPulse.halfCycleDuration, easing: Easing.inOut(Easing.ease) }),
    -1,
    true,
  );
}

/** Stops the pulse and freezes the ring at the shared reduce-motion/paused
 * opacity — same worklet-callable-from-either-thread reasoning as above. */
function pauseGlowPulse(opacity: SharedValue<number>) {
  "worklet";
  cancelAnimation(opacity);
  opacity.value = GLOW_STATIC_OPACITY;
}

/**
 * Pulsing translucent ring behind the recommended node — opacity-only,
 * reanimated worklet (D3: migrated off RN-core `Animated`, see module doc).
 * Never touches layout (`position: absolute`, no size/position changes).
 * Paused while `isScrolling` is true (see module doc) — reduce-motion still
 * takes precedence over everything, including scroll state.
 */
function GlowRing({ size, isScrolling }: { size: number; isScrolling: SharedValue<boolean> }) {
  const reduceMotion = useReduceMotion();
  const { colors } = useTheme();
  const opacity = useSharedValue(reduceMotion ? GLOW_STATIC_OPACITY : GLOW_MIN_OPACITY);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = GLOW_STATIC_OPACITY;
      return;
    }
    if (isScrolling.value) {
      opacity.value = GLOW_STATIC_OPACITY;
    } else {
      startGlowPulse(opacity);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // UI-thread reaction to scroll state — never touches React state/props,
  // so a scroll gesture never triggers a re-render of this tree.
  useAnimatedReaction(
    () => isScrolling.value,
    (scrolling, previousScrolling) => {
      if (reduceMotion) return; // reduce-motion: always static, scroll state irrelevant
      if (previousScrolling === null || scrolling === previousScrolling) return;
      if (scrolling) {
        pauseGlowPulse(opacity);
      } else {
        startGlowPulse(opacity);
      }
    },
    [reduceMotion],
  );

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          // `pointerEvents` va en el estilo, no como prop: como prop está
          // deprecado y en web (react-native-web) emite un aviso en consola.
          pointerEvents: "none",
          position: "absolute",
          top: -GLOW_EXTRA / 2,
          left: -GLOW_EXTRA / 2,
          width: size + GLOW_EXTRA,
          height: size + GLOW_EXTRA,
          borderRadius: (size + GLOW_EXTRA) / 2,
          backgroundColor: colors.accent,
        },
        animatedStyle,
      ]}
    />
  );
}

/**
 * Per-node entrance (spec §4.4): fade + rise, `springs.settle`, delayed by
 * `index * ENTRANCE_STAGGER_MS`. Mount-only effect (empty deps) — no
 * `hasEntered` React state needed here, see module doc for why that's safe
 * (unlike Home/D2, this component only ever mounts once per real visit).
 * `useSharedValue`/`useAnimatedStyle` mutations are NOT React state, so this
 * never trips `react-hooks/set-state-in-effect` the way a plain
 * `setState(...)` inside an effect body would (that's the D2 lesson this
 * sidesteps entirely rather than reproducing its workaround).
 */
function useNodeEntrance(index: number, reduceMotion: boolean) {
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const translateY = useSharedValue(reduceMotion ? 0 : ENTRANCE_RISE_DP);

  useEffect(() => {
    if (reduceMotion) return;
    const delay = index * ENTRANCE_STAGGER_MS;
    opacity.value = withDelay(delay, withTiming(1, { duration: springs.settle.duration }));
    translateY.value = withDelay(delay, withSpring(0, springs.settle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

function TopicCircle({ node, isScrolling, offset }: { node: TopicNodeData; isScrolling: SharedValue<boolean>; offset: number }) {
  const { colors } = useTheme();
  const size = node.recommended ? RECOMMENDED_NODE_SIZE : NODE_SIZE;
  const done = node.status === "done";
  const bg = done ? colors.successBg : node.recommended ? colors.accent : colors.elevated;
  const borderColor = done ? colors.success : node.recommended ? colors.accent : colors.border;
  const glyphColor = done ? colors.success : node.recommended ? colors.accentContrast : colors.muted;

  return (
    <View style={{ width: RAIL_WIDTH, alignItems: "center", justifyContent: "center" }}>
      <View style={{ transform: [{ translateX: offset }] }}>
        {node.recommended ? <GlowRing size={size} isScrolling={isScrolling} /> : null}
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            borderWidth: node.recommended ? 0 : 1,
            borderColor,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: glyphColor, fontSize: typography.small.fontSize, fontWeight: typography.weights.bold }}>
            {done ? "✓" : node.order + 1}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Diamond badge — a 45°-rotated square sits BEHIND an upright glyph, so the check/diamond mark itself never rotates. Visually distinct from the round topic nodes without resorting to an emoji trophy. */
function MilestoneDiamond({ node, offset }: { node: MilestoneNodeData; offset: number }) {
  const { colors } = useTheme();
  const done = node.status === "done";
  const size = NODE_SIZE * 0.7;
  return (
    <View style={{ width: RAIL_WIDTH, height: NODE_SIZE, alignItems: "center", justifyContent: "center" }}>
      <View style={{ transform: [{ translateX: offset }] }}>
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: radius.sm,
            backgroundColor: done ? colors.warningBg : colors.elevated,
            borderWidth: 2,
            borderColor: colors.warning,
            transform: [{ rotate: "45deg" }],
          }}
        />
        <Text style={{ color: colors.warning, fontSize: typography.small.fontSize, fontWeight: typography.weights.bold }}>
          {done ? "✓" : "◆"}
        </Text>
      </View>
    </View>
  );
}

function TopicCard({ node, showStars }: { node: TopicNodeData; showStars: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const done = node.status === "done";
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: node.recommended ? colors.accent : colors.border,
        backgroundColor: node.recommended ? colors.accentLight : colors.surfaceRaised,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
        gap: spacing.xs,
      }}
    >
      {node.recommended ? (
        <Text
          numberOfLines={1}
          style={{
            color: colors.accent,
            fontSize: typography.caption.fontSize,
            lineHeight: typography.caption.lineHeight,
            fontWeight: typography.weights.semibold,
          }}
        >
          {t.skillTree.recommendedBadge}
        </Text>
      ) : (
        <Text
          numberOfLines={1}
          style={{
            color: colors.muted,
            fontSize: typography.eyebrow.fontSize,
            lineHeight: typography.eyebrow.lineHeight,
            letterSpacing: typography.eyebrow.letterSpacing,
            fontWeight: typography.weights.semibold,
            textTransform: "uppercase",
          }}
        >
          {t.skillTree.topicLabel(node.order + 1)}
        </Text>
      )}
      <Text
        numberOfLines={2}
        style={{
          color: colors.foreground,
          fontSize: typography.small.fontSize,
          lineHeight: typography.small.lineHeight,
          fontWeight: typography.weights.medium,
        }}
      >
        {node.title}
      </Text>
      {done ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Text
            numberOfLines={1}
            style={{
              color: colors.success,
              fontSize: typography.caption.fontSize,
              lineHeight: typography.caption.lineHeight,
              fontWeight: typography.weights.semibold,
            }}
          >
            {t.skillTree.completedLabel}
          </Text>
          {/* Plan-xp-progreso Fase 2: in shadow, hide stars entirely — don't draw empty ones. */}
          {showStars ? <Stars count={node.stars} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function MilestoneCard({ node }: { node: MilestoneNodeData }) {
  const t = useT();
  const { colors } = useTheme();
  const done = node.status === "done";
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.warning,
        backgroundColor: done ? colors.warningBg : colors.surfaceRaised,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
        gap: spacing.xs,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          color: colors.warning,
          fontSize: typography.eyebrow.fontSize,
          lineHeight: typography.eyebrow.lineHeight,
          letterSpacing: typography.eyebrow.letterSpacing,
          fontWeight: typography.weights.semibold,
          textTransform: "uppercase",
        }}
      >
        {t.skillTree.milestone[node.milestoneKind]}
      </Text>
      <Text
        numberOfLines={2}
        style={{
          color: colors.foreground,
          fontSize: typography.small.fontSize,
          lineHeight: typography.small.lineHeight,
          fontWeight: typography.weights.medium,
        }}
      >
        {node.title}
      </Text>
      {done ? (
        <Text
          numberOfLines={1}
          style={{ color: colors.warning, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}
        >
          {t.skillTree.completedLabel}
        </Text>
      ) : null}
    </View>
  );
}

function TreeRow({
  node,
  side,
  index,
  reduceMotion,
  isScrolling,
  onTopicPress,
  onMilestonePress,
  pitch,
  showStars,
}: {
  node: SkillTreeNode;
  side: "left" | "right";
  index: number;
  reduceMotion: boolean;
  isScrolling: SharedValue<boolean>;
  onTopicPress: (topicId: string) => void;
  onMilestonePress: (milestoneId: string) => void;
  pitch: number;
  showStars: boolean;
}) {
  const t = useT();
  const entranceStyle = useNodeEntrance(index, reduceMotion);
  const nodeOffset = node.kind === "milestone" ? 0 : nodeX(index, node);
  const circle =
    node.kind === "topic" ? (
      <TopicCircle node={node} isScrolling={isScrolling} offset={nodeOffset} />
    ) : (
      <MilestoneDiamond node={node} offset={nodeOffset} />
    );
  const card = node.kind === "topic" ? <TopicCard node={node} showStars={showStars} /> : <MilestoneCard node={node} />;
  const label = node.kind === "topic" ? (node.recommended ? `${t.skillTree.recommendedBadge}: ${node.title}` : node.title) : node.title;

  return (
    <Animated.View style={entranceStyle}>
      <PressableScale
        accessibilityLabel={label}
        hitSlop={spacing.sm}
        onPress={() => (node.kind === "topic" ? onTopicPress(node.id) : onMilestonePress(node.id))}
        style={{ flexDirection: "row", alignItems: "center", height: pitch }}
      >
        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: spacing.xs }}>{side === "left" ? card : null}</View>
        {circle}
        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: spacing.xs }}>{side === "right" ? card : null}</View>
      </PressableScale>
    </Animated.View>
  );
}

/** Build the SVG path strings for the styled rail in either display order. */
function useRailPaths(nodes: readonly SkillTreeNode[], pitch: number) {
  const { segments } = buildRailGeometry(nodes, pitch);
  const { done, pending, boundaries } = splitRailByStatus(segments);

  return {
    doneD: done.map(bezierSegmentD).join(" "),
    pendingD: pending.map(bezierSegmentD).join(" "),
    boundaries,
  };
}

function RailSvg({
  nodes,
  pitch,
  contentWidth,
}: {
  nodes: readonly SkillTreeNode[];
  pitch: number;
  contentWidth: number;
}) {
  const { colors } = useTheme();
  const totalHeight = nodes.length * pitch;
  const centerX = contentWidth / 2;
  const { doneD, pendingD, boundaries } = useRailPaths(nodes, pitch);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    >
      <Svg width="100%" height={totalHeight} style={{ pointerEvents: "none" }}>
        <Defs>
          {boundaries.map((segment, i) => (
            <LinearGradient
              key={`rail-grad-${segment.fromNode.id}-${segment.toNode.id}`}
              id={`railGradient-${i}`}
              x1="0"
              y1={segment.from.y}
              x2="0"
              y2={segment.to.y}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={segment.fromNode.status === "done" ? colors.success : colors.border} />
              <Stop offset="1" stopColor={segment.toNode.status === "done" ? colors.success : colors.border} />
            </LinearGradient>
          ))}
        </Defs>
        <G transform={`translate(${centerX}, 0)`} style={{ pointerEvents: "none" }}>
          {doneD && <Path d={doneD} stroke={colors.success} strokeWidth={3} fill="none" strokeLinecap="round" />}
          {pendingD && (
            <Path
              d={pendingD}
              stroke={colors.border}
              strokeWidth={2}
              fill="none"
              strokeDasharray={PENDING_DASHARRAY}
              strokeLinecap="round"
            />
          )}
          {boundaries.map((segment, i) => (
            <Path
              key={`rail-boundary-${segment.fromNode.id}-${segment.toNode.id}`}
              d={bezierSegmentD(segment)}
              stroke={`url(#railGradient-${i})`}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}

function TreeCap({
  slot,
  copy,
  placement,
}: {
  slot: SkillTreeCapSlot;
  copy: { start: string; advancedUp: string; advancedDown: string };
  placement: "top" | "bottom";
}) {
  const { colors } = useTheme();
  const isStart = slot.kind === "start";
  return (
    <Text
      style={
        isStart
          ? {
              color: colors.muted,
              fontSize: typography.eyebrow.fontSize,
              lineHeight: typography.eyebrow.lineHeight,
              letterSpacing: typography.eyebrow.letterSpacing,
              fontWeight: typography.weights.bold,
              textAlign: "center",
              marginTop: placement === "bottom" ? spacing.md : 0,
              marginBottom: placement === "top" ? spacing.md : 0,
            }
          : {
              color: colors.muted,
              fontSize: typography.caption.fontSize,
              textAlign: "center",
              marginTop: placement === "bottom" ? spacing.md : 0,
              marginBottom: placement === "top" ? spacing.md : 0,
            }
      }
    >
      {formatSkillTreeCap(slot, copy)}
    </Text>
  );
}

export function SkillTree(props: {
  temario: Pick<Temario, "topics" | "milestones">;
  /** `syllabus` reads top-down; `gameMap` preserves the legacy flat bottom-up route. */
  order: SkillTreeOrder;
  /**
   * Written on the UI thread by the owning screen's `useAnimatedScrollHandler`
   * (see this module's doc): true while the student is dragging/flinging the
   * tree, so `GlowRing` can hold its pulse and give the scroll every frame.
   */
  isScrolling: SharedValue<boolean>;
  onTopicPress: (topicId: string) => void;
  onMilestonePress: (milestoneId: string) => void;
  /**
   * Plan-xp-progreso Fase 2 — when false (shadow mode), stars are not
   * rendered at all. Defaults to true for backwards-compatible call sites.
   */
  showStars?: boolean;
  /**
   * Autoscroll de entrada (temario.tsx, 2026-08-06): se invoca desde el
   * `onLayout` del contenedor de filas con la Y del CENTRO del nodo
   * recomendado, relativa a la raíz de SkillTree (`null` cuando no hay
   * recomendado — todo done o sin temas). Por encima de las filas solo
   * está el header del árbol (routeLabel + hint), que es justo lo que mide
   * ese `layout.y`; por debajo, la geometría es determinista
   * (`index * pitch + pitch/2`, `lib/skillTreeRail.ts`) y no requiere
   * medición por nodo.
   */
  onRecommendedCenterY?: (centerY: number | null) => void;
  /**
   * C2-d: forwarded straight to `buildSkillTreeNodes`'s `recommendedIdOverride`
   * (see that function's doc) — the grouped/collapsible-by-unit rendering
   * passes the GLOBALLY-recommended topic id here so only the one unit that
   * actually contains it ever glows, instead of every rendered unit picking
   * its own local "first not-done" fallback. `undefined` (default) keeps
   * this component's un-grouped call site (the flat rail) unchanged.
   */
  recommendedTopicId?: string | null;
}) {
  const t = useT();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const { width: windowWidth } = useWindowDimensions();
  const fontScale = PixelRatio.getFontScale();
  const rowPitch = BASE_PITCH * fontScale;
  const contentWidth = Math.max(0, windowWidth - spacing.lg * 2);
  const nodes = orderSkillTreeNodes(buildSkillTreeNodes(props.temario, props.recommendedTopicId), props.order);
  const showStars = props.showStars ?? true;
  const recommendedIndex = nodes.findIndex((n) => n.kind === "topic" && n.recommended);
  const chrome = skillTreeChrome(props.order);
  const capCopy = {
    start: t.skillTree.startCap,
    advancedUp: t.skillTree.routeHint,
    advancedDown: t.skillTree.routeHintDown,
  };

  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.eyebrow.fontSize,
            lineHeight: typography.eyebrow.lineHeight,
            letterSpacing: typography.eyebrow.letterSpacing,
            fontWeight: typography.weights.bold,
          }}
        >
          {t.skillTree.routeLabel}
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>
      <TreeCap slot={chrome.top} copy={capCopy} placement="top" />

      <View
        style={{ position: "relative" }}
        onLayout={
          props.onRecommendedCenterY
            ? (e) =>
                props.onRecommendedCenterY?.(
                  recommendedIndex >= 0 ? e.nativeEvent.layout.y + nodeCenterY(recommendedIndex, rowPitch) : null,
                )
            : undefined
        }
      >
        <RailSvg nodes={nodes} pitch={rowPitch} contentWidth={contentWidth} />
        <View style={{ zIndex: 1 }}>
          {nodes.map((node, i) => (
            <TreeRow
              key={node.id}
              node={node}
              side={sideForIndex(i)}
              index={i}
              reduceMotion={reduceMotion}
              isScrolling={props.isScrolling}
              onTopicPress={props.onTopicPress}
              onMilestonePress={props.onMilestonePress}
              pitch={rowPitch}
              showStars={showStars}
            />
          ))}
        </View>
      </View>

      <TreeCap slot={chrome.bottom} copy={capCopy} placement="bottom" />
    </View>
  );
}
