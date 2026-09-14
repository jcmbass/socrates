/**
 * One tutor reply — NOT a bubble, to give math/long prose most of the
 * horizontal space (A4 §4.1, mirroring the harness's `max-w-prose` tutor
 * column vs. the student's 85% bubble). A small circular `TutorAvatar`
 * (DESIGN.md §5) sits top-left of every reply, calm and consistent —
 * never next to the student's own bubble.
 *
 * ── KATEX-IN-WEBVIEW (F1/WP6 Part 2, DF-5.3) ────────────────────────────
 * `streaming=false` (default, a COMPLETE reply): renders via `WebView` +
 * `lib/tutorMarkup.ts` — KaTeX's `renderToString` runs in the RN JS thread
 * (Hermes; isomorphic, no DOM needed) to produce static HTML, which the
 * WebView just displays (no script executes there except a tiny
 * height-measurement snippet). This keeps KaTeX's typography
 * byte-consistent with the harness (D2 §4.2: "no se sustituye por un
 * renderer nativo alterno") without the WebView-bridge fragility
 * `docs/LECCIONES-Y-BUGS.md` (2026-07-11) warns about.
 *
 * `streaming=true` (a turn still arriving, DF-5.2): renders plain `<Text>`
 * instead — reloading the WebView's `source={{html}}` on every ~30ms
 * streamed chunk (see apps/server/src/models/fake-adapters.ts) would mean
 * a full page reload that often on a low-end device (moto e13, ~1.8GB RAM,
 * F1/WP6 Part 3's target), a real perf risk this skeleton doesn't need to
 * take. The screen (app/study/[subjectId].tsx) swaps this component's
 * `streaming` prop to `false` the instant the turn completes, so math still
 * renders within the same message — just not mid-keystroke. FLAGGED for
 * architect review as a deviation from a literal "progressive KaTeX
 * render"; verify empirically on-device (Part 3) whether debounced
 * in-place KaTeX updates during streaming are worth the added complexity.
 *
 * Craft spec §5.2 (D4): `animate` (default false) plays the shared
 * new-message entrance (fade + rise 8dp) on BOTH the streaming and the
 * rendered branch — `useMessageEntranceStyle`'s module doc owns the
 * mechanism/new-vs-historical distinction. This mirrors `TutorMessage.web.tsx`;
 * keep the two in sync (see that file's own doc for why it exists at all).
 */
import { useMemo, useState } from "react";
import { Text } from "react-native";
import Animated from "react-native-reanimated";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useReduceMotion, useTheme } from "../theme/useTheme";
import { spacing, typography } from "../theme/tokens";
import { buildTutorHtmlDocument, renderTutorHtml } from "../lib/tutorMarkup";
import { useMessageEntranceStyle } from "./useMessageEntrance";
import { TutorAvatar } from "./TutorAvatar";

/** Posts document.body.scrollHeight back to RN so the WebView can size itself to its (variable, math-dependent) content instead of clipping/scrolling internally. */
const HEIGHT_MEASURE_SCRIPT = `(function () {
  function post() {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(String(document.body.scrollHeight));
    }
  }
  post();
  window.addEventListener('load', post);
  setTimeout(post, 60);
  setTimeout(post, 300);
  true;
})();`;

const MIN_WEBVIEW_HEIGHT = 24;

export function TutorMessage(props: { text: string; streaming?: boolean; animate?: boolean }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const entranceStyle = useMessageEntranceStyle(props.animate ?? false, reduceMotion);

  if (props.streaming) {
    return (
      <Animated.View
        style={[{ width: "100%", flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm }, entranceStyle]}
      >
        <TutorAvatar />
        <Text
          style={{
            flex: 1,
            color: colors.foreground,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
            fontFamily: typography.fontFamily.regular,
          }}
        >
          {props.text}
        </Text>
      </Animated.View>
    );
  }

  return <RenderedTutorMessage text={props.text} foreground={colors.foreground} entranceStyle={entranceStyle} />;
}

function RenderedTutorMessage(props: {
  text: string;
  foreground: string;
  entranceStyle: ReturnType<typeof useMessageEntranceStyle>;
}) {
  const [height, setHeight] = useState(MIN_WEBVIEW_HEIGHT);

  const html = useMemo(
    () => buildTutorHtmlDocument(renderTutorHtml(props.text), { foreground: props.foreground }),
    [props.text, props.foreground],
  );

  function handleMessage(event: WebViewMessageEvent) {
    const measured = Number(event.nativeEvent.data);
    if (Number.isFinite(measured) && measured > 0) setHeight(Math.max(MIN_WEBVIEW_HEIGHT, measured));
  }

  return (
    <Animated.View
      style={[{ width: "100%", flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm }, props.entranceStyle]}
    >
      <TutorAvatar />
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        style={{ flex: 1, height, backgroundColor: "transparent" }}
        scrollEnabled={false}
        nestedScrollEnabled={false}
        injectedJavaScript={HEIGHT_MEASURE_SCRIPT}
        onMessage={handleMessage}
      />
    </Animated.View>
  );
}
