/**
 * Web counterpart of `TutorMessage.tsx` (Metro auto-resolves this `.web.tsx`
 * suffix ONLY for the web bundle — the device file is untouched and its
 * WebView-based render keeps working exactly as before on iOS/Android).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * `react-native-webview` has no web implementation — on web it renders the
 * literal string "React Native WebView does not support this platform.",
 * which is exactly what showed up in place of every tutor reply when the
 * app ran in a browser. This file replaces that renderer for web ONLY,
 * with zero import of `react-native-webview`.
 *
 * ── APPROACH: REAL DOM + REAL HTML (not a re-formatted-text fallback) ────
 * On web, react-native-web already renders through `react-dom`, so there's
 * a real DOM available (unlike device, where a WebView bridge is the only
 * way to get a DOM). That means the exact same `renderTutorHtml(text)`
 * output `TutorMessage.tsx` hands to its WebView (KaTeX -> static HTML,
 * `lib/tutorMarkup.ts`, isomorphic — no DOM needed to PRODUCE it) can be
 * injected straight into a real DOM node here via `dangerouslySetInnerHTML`,
 * giving byte-identical KaTeX typography to the device renderer (same
 * concern `TutorMessage.tsx`'s module doc flags for D2 §4.2) without any
 * WebView, bridge, or postMessage plumbing. This was preferred over
 * reformatting the tutor's text with plain RN <Text> components (the
 * documented fallback-of-last-resort) because it's not meaningfully more
 * fragile — no CSP/sizing tricks needed, since this DOM node lives directly
 * in the page rather than in a sandboxed iframe — and it keeps math
 * rendering intact, which the plain-text fallback would have dropped.
 *
 * KaTeX's CSS (`theme/katexCss.ts`) is injected once into `document.head`
 * (module-level guard by element id) rather than per-message, since on web
 * every tutor message would otherwise duplicate the same ~14KB of rules.
 *
 * Craft spec §5.2 (D4): `animate` prop mirrors `TutorMessage.tsx` exactly —
 * same `useMessageEntranceStyle` mechanism, applied to the same outer
 * `View`/`Animated.View` wrapper this file already had. Keep both files'
 * `animate` handling in sync.
 */
import { useEffect, useMemo } from "react";
import { Text } from "react-native";
import Animated from "react-native-reanimated";

import { useReduceMotion, useTheme } from "../theme/useTheme";
import { spacing, typography } from "../theme/tokens";
import { renderTutorHtml } from "../lib/tutorMarkup";
import { KATEX_CSS } from "../theme/katexCss";
import { useMessageEntranceStyle } from "./useMessageEntrance";
import { TutorAvatar } from "./TutorAvatar";

const KATEX_STYLE_ELEMENT_ID = "tutor-message-katex-style";

/** Same rules `buildTutorHtmlDocument` (lib/tutorMarkup.ts) sets on its WebView document's `body`/`.katex*`, scoped here to `.tutor-html-body` instead since this shares the real page's `<head>` with everything else. */
const TUTOR_HTML_BODY_CSS = `
.tutor-html-body{font-family:Inter,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;font-size:17px;line-height:1.53;word-wrap:break-word;}
.tutor-html-body code,.tutor-html-body pre{font-family:"JetBrains Mono",Menlo,Consolas,monospace;}
.tutor-html-body .katex-display{margin:0.5em 0;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;}
.tutor-html-body .katex{font-size:1.05em;}
`;

function ensureKatexStyleInjected() {
  if (typeof document === "undefined") return;
  if (document.getElementById(KATEX_STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = KATEX_STYLE_ELEMENT_ID;
  style.textContent = KATEX_CSS + TUTOR_HTML_BODY_CSS;
  document.head.appendChild(style);
}

export function TutorMessage(props: { text: string; streaming?: boolean; animate?: boolean }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const entranceStyle = useMessageEntranceStyle(props.animate ?? false, reduceMotion);

  useEffect(() => {
    ensureKatexStyleInjected();
  }, []);

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

  return <RenderedTutorMessageWeb text={props.text} foreground={colors.foreground} entranceStyle={entranceStyle} />;
}

function RenderedTutorMessageWeb(props: {
  text: string;
  foreground: string;
  entranceStyle: ReturnType<typeof useMessageEntranceStyle>;
}) {
  const html = useMemo(() => renderTutorHtml(props.text), [props.text]);

  return (
    <Animated.View
      style={[{ width: "100%", flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm }, props.entranceStyle]}
    >
      <TutorAvatar />
      {/* Real DOM node (react-dom, under react-native-web) — NOT a WebView. */}
      <div
        className="tutor-html-body"
        style={{ flex: 1, minWidth: 0, color: props.foreground }}
        // eslint-disable-next-line react/no-danger -- html comes from renderTutorHtml, which escapes all non-KaTeX text (lib/tutorMarkup.ts).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Animated.View>
  );
}
