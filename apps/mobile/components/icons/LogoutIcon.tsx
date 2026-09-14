/**
 * Logout icon used in the home header to replace the plain "Salir" text.
 *
 * Standard door-with-exiting-arrow glyph, stroke style to match the other
 * action icons (ClipIcon, SendIcon). Component contract: size + color props.
 */
import Svg, { Path } from "react-native-svg";

export function LogoutIcon(props: { size?: number; color?: string }) {
  const size = props.size ?? 22;
  const color = props.color ?? "#58a6ff";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4M16 17l5-5-5-5M21 12H9"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
