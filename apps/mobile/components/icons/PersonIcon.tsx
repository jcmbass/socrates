/**
 * Person glyph for the home header's Profile entry point (C2-b) — replaces
 * the red "Eliminar mi cuenta" text + `LogoutIcon` pair that used to live
 * there (the arquitecto flagged that pairing as the loudest thing on the
 * whole screen). Stroke style to match `LogoutIcon`/`ClipIcon`/`SendIcon`.
 */
import Svg, { Circle, Path } from "react-native-svg";

export function PersonIcon(props: { size?: number; color?: string }) {
  const size = props.size ?? 22;
  const color = props.color ?? "#58a6ff";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={3.5} stroke={color} strokeWidth={2} />
      <Path
        d="M4.5 20c1.2-3.6 4.2-5.5 7.5-5.5s6.3 1.9 7.5 5.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
