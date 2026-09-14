/**
 * Paperclip icon used for the "attach source" action in the chat composer.
 *
 * Replaces the previous emoji (📎) with a vector glyph so the size, stroke
 * width and color are fully theme-controllable. Stroke is 2dp, sized at 22dp
 * by default — the same visual weight as the send arrow glyph (20dp) so it
 * does not dominate the composer bar.
 *
 * The path below is a standard paperclip shape. It can be swapped for the
 * exact svgrepo asset once it is available; the component contract (size +
 * color props) stays the same.
 */
import Svg, { Path } from "react-native-svg";

export function ClipIcon(props: { size?: number; color?: string }) {
  const size = props.size ?? 22;
  const color = props.color ?? "#58a6ff";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M16.5 6v11.5a4.5 4.5 0 01-9 0V5a3 3 0 016 0v10.5a1.5 1.5 0 01-3 0V6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
