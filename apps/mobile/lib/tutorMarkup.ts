/**
 * Tutor text -> HTML for the KaTeX WebView renderer (components/TutorMessage.tsx).
 *
 * ── WHY NO WEBVIEW-SIDE JS ────────────────────────────────────────────────
 * KaTeX's `renderToString` is isomorphic (documented server-side usage,
 * verified: it runs under plain Node with no DOM) — so math gets rendered
 * to a static HTML string HERE, in the RN JS thread (Hermes), and only the
 * resulting HTML+CSS is handed to the WebView via `source={{ html }}`. This
 * avoids the exact class of bug `docs/LECCIONES-Y-BUGS.md` (2026-07-11)
 * warns about for WebView bridges (a `postMessage` channel notoriously hard
 * to test without the real device) — there is no bridge here, no script
 * running inside the WebView except a tiny height-measurement snippet
 * (TutorMessage.tsx). It also makes this whole module PURE and unit
 * -testable under vitest/node, unlike a WebView-executed KaTeX would be.
 *
 * ── STREAMING-SAFE PARSING ────────────────────────────────────────────────
 * `parseMathSegments` never throws on an unclosed `$`/`$$` — mid-stream text
 * legitimately has an open, not-yet-closed delimiter. An unclosed delimiter
 * (and everything after it) is treated as literal text until a later chunk
 * closes it. (In practice TutorMessage.tsx only calls this once a turn is
 * COMPLETE — see its module doc for why — but the parser stays
 * streaming-safe regardless, since it's cheap and removes a footgun for any
 * future caller that feeds it partial text.)
 */
import katex from "katex";
import { KATEX_CSS } from "../theme/katexCss";

export interface MathSegment {
  type: "text" | "math";
  content: string;
  displayMode?: boolean;
}

export function parseMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let i = 0;

  while (i < text.length) {
    if (text.startsWith("$$", i)) {
      const end = text.indexOf("$$", i + 2);
      if (end === -1) {
        segments.push({ type: "text", content: text.slice(i) });
        break;
      }
      segments.push({ type: "math", content: text.slice(i + 2, end), displayMode: true });
      i = end + 2;
      continue;
    }

    if (text[i] === "$") {
      const end = text.indexOf("$", i + 1);
      if (end === -1) {
        segments.push({ type: "text", content: text.slice(i) });
        break;
      }
      const inner = text.slice(i + 1, end);
      if (inner.length === 0) {
        // "$$" already handled above; a lone "$" immediately followed by
        // another "$" that ISN'T a block delimiter can't happen here, but
        // guard anyway rather than emit a zero-width math segment.
        segments.push({ type: "text", content: "$" });
        i += 1;
        continue;
      }
      segments.push({ type: "math", content: inner, displayMode: false });
      i = end + 1;
      continue;
    }

    const next = text.indexOf("$", i);
    const chunk = next === -1 ? text.slice(i) : text.slice(i, next);
    segments.push({ type: "text", content: chunk });
    i = next === -1 ? text.length : next;
  }

  return mergeAdjacentText(segments);
}

function mergeAdjacentText(segments: MathSegment[]): MathSegment[] {
  const merged: MathSegment[] = [];
  for (const seg of segments) {
    const last = merged.at(-1);
    if (seg.type === "text" && seg.content === "") continue;
    if (last && last.type === "text" && seg.type === "text") {
      last.content += seg.content;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text segment -> HTML fragment: escaped, newlines as <br/>. */
function textSegmentToHtml(text: string): string {
  return escapeHtml(text).split("\n").join("<br/>");
}

/** One math segment -> KaTeX HTML. Never throws — an invalid expression falls back to its literal source, escaped. */
function mathSegmentToHtml(seg: MathSegment): string {
  try {
    return katex.renderToString(seg.content, {
      throwOnError: false,
      displayMode: seg.displayMode === true,
      output: "html",
    });
  } catch {
    const literal = seg.displayMode ? `$$${seg.content}$$` : `$${seg.content}$`;
    return escapeHtml(literal);
  }
}

/** Full tutor reply -> HTML body fragment (math rendered, text escaped). */
export function renderTutorHtml(rawText: string): string {
  return parseMathSegments(rawText)
    .map((seg) => (seg.type === "math" ? mathSegmentToHtml(seg) : textSegmentToHtml(seg.content)))
    .join("");
}

/**
 * Wraps a rendered body fragment into the full HTML document the WebView
 * loads.
 *
 * ── BRAND FONT IN THE WEBVIEW (DESIGN.md §3) ─────────────────────────────
 * The WebView is an isolated rendering context — it does NOT see fonts
 * loaded natively via `expo-font`/`useFonts` in `app/_layout.tsx`. The
 * `font-family` stack below leads with `Inter`/`"JetBrains Mono"` in case a
 * future WebView build ever has them available (harmless no-op today: no
 * `@font-face` declares them here, so both names simply fail to match and
 * the stack falls through to the system sans-serif), and falls back to the
 * system stack, same as before. FLAGGED for follow-up, same spirit as the
 * KaTeX glyph-font note above: embedding real Inter/JetBrains Mono
 * `@font-face` rules (local asset or CDN, mirroring how `KATEX_CSS` pulls
 * KaTeX's glyph fonts from jsdelivr) is the natural next step if device
 * testing shows the system-font fallback reads as off-brand. KaTeX's own
 * math glyphs are UNAFFECTED either way — `.katex` always sets its own
 * `KaTeX_*` families regardless of `body`'s font-family (see katexCss.ts).
 */
export function buildTutorHtmlDocument(bodyHtml: string, opts: { foreground: string }): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>
${KATEX_CSS}
  html,body{margin:0;padding:0;background:transparent;}
  body{
    color:${opts.foreground};
    font-family:Inter,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;
    font-size:17px;
    line-height:1.53;
    padding:0 1px;
    word-wrap:break-word;
  }
  code,pre{font-family:"JetBrains Mono",Menlo,Consolas,monospace;}
  .katex-display{margin:0.5em 0;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;}
  .katex{font-size:1.05em;}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}
