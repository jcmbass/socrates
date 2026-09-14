/**
 * Send icon (paper airplane) used for the chat send button.
 *
 * Replaces the previous arrow emoji (↑) with a vector glyph so the size,
 * stroke width and color are fully theme-controllable. Stroke is 2dp,
 * sized at 20dp by default — same visual weight as the clip icon (22dp)
 * so the two action glyphs feel like a matched pair in the composer bar.
 *
 * Supports either a static `color` or an animated `colorValue` shared
 * value (e.g. from reanimated's `useDerivedValue`) so consumers can
 * crossfade the glyph color without re-rendering React per frame.
 *
 * The path below is a standard paper-airplane send shape. It can be
 * swapped for the exact svgrepo asset once it is available; the component
 * contract (size + color/colorValue props) stays the same.
 */
import Svg, { Path } from "react-native-svg";
import Animated, { type SharedValue, useAnimatedProps } from "react-native-reanimated";

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function SendIcon(props: {
  size?: number;
  /** Static color; ignored when `colorValue` is provided. */
  color?: string;
  /** Animated color shared value; takes precedence over `color`. */
  colorValue?: SharedValue<string>;
}) {
  const size = props.size ?? 20;
  const fallbackColor = props.color ?? "#58a6ff";

  const animatedProps = useAnimatedProps(() => ({
    stroke: props.colorValue?.value ?? fallbackColor,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedPath
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        stroke={fallbackColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
