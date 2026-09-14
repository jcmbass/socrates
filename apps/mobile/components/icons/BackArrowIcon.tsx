/**
 * Left-arrow glyph (svgrepo #510041, licencia CC0) for back-navigation
 * controls — replaces the "‹" text character in OnboardBackButton so the
 * glyph is a real vector with theme-controlled size and color, same
 * approach as SendIcon. Unlike SendIcon this asset is FILL-based (a
 * filled evenodd shape, not a stroke), so `color` maps to `fill`.
 */
import Svg, { Path } from "react-native-svg";

export function BackArrowIcon(props: { size?: number; color?: string }) {
  const size = props.size ?? 20;
  const color = props.color ?? "#c9d1d9";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.7071 4.29289C12.0976 4.68342 12.0976 5.31658 11.7071 5.70711L6.41421 11H20C20.5523 11 21 11.4477 21 12C21 12.5523 20.5523 13 20 13H6.41421L11.7071 18.2929C12.0976 18.6834 12.0976 19.3166 11.7071 19.7071C11.3166 20.0976 10.6834 20.0976 10.2929 19.7071L3.29289 12.7071C3.10536 12.5196 3 12.2652 3 12C3 11.7348 3.10536 11.4804 3.29289 11.2929L10.2929 4.29289C10.6834 3.90237 11.3166 3.90237 11.7071 4.29289Z"
        fill={color}
      />
    </Svg>
  );
}
