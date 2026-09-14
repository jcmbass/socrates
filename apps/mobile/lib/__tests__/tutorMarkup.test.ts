import { describe, expect, it } from "vitest";
import { buildTutorHtmlDocument, parseMathSegments, renderTutorHtml } from "../tutorMarkup";

describe("parseMathSegments", () => {
  it("splits plain text with no math into a single text segment", () => {
    expect(parseMathSegments("hola, ¿cómo estás?")).toEqual([{ type: "text", content: "hola, ¿cómo estás?" }]);
  });

  it("parses inline math ($...$)", () => {
    expect(parseMathSegments("la derivada de $x^2$ es 2x")).toEqual([
      { type: "text", content: "la derivada de " },
      { type: "math", content: "x^2", displayMode: false },
      { type: "text", content: " es 2x" },
    ]);
  });

  it("parses block math ($$...$$)", () => {
    expect(parseMathSegments("mirá:\n\n$$a^2+b^2=c^2$$\n\n¿qué ves?")).toEqual([
      { type: "text", content: "mirá:\n\n" },
      { type: "math", content: "a^2+b^2=c^2", displayMode: true },
      { type: "text", content: "\n\n¿qué ves?" },
    ]);
  });

  it("treats an UNCLOSED delimiter as literal text (streaming-safe)", () => {
    expect(parseMathSegments("pensá en $x^2")).toEqual([{ type: "text", content: "pensá en $x^2" }]);
    expect(parseMathSegments("mirá esto: $$a^2 + b")).toEqual([{ type: "text", content: "mirá esto: $$a^2 + b" }]);
  });

  it("handles multiple math segments in one message", () => {
    const segments = parseMathSegments("$a$ y $b$ son distintos");
    expect(segments.map((s) => s.type)).toEqual(["math", "text", "math", "text"]);
  });
});

describe("renderTutorHtml", () => {
  it("escapes plain text and converts newlines to <br/>", () => {
    const html = renderTutorHtml("a < b\ny \"esto\" & aquello");
    expect(html).toContain("a &lt; b");
    expect(html).toContain("<br/>");
    expect(html).toContain("&quot;esto&quot;");
    expect(html).toContain("&amp;");
  });

  it("renders inline math to a KaTeX span", () => {
    const html = renderTutorHtml("la derivada de $x^2$ es $2x$");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("katex-display");
  });

  it("renders block math with the katex-display wrapper", () => {
    const html = renderTutorHtml("$$\\int_0^1 x\\,dx = \\frac{1}{2}$$");
    expect(html).toContain("katex-display");
  });

  it("never throws on a malformed expression — falls back to escaped literal text", () => {
    expect(() => renderTutorHtml("esto está roto: $\\frac{1$")).not.toThrow();
  });
});

describe("buildTutorHtmlDocument", () => {
  it("embeds the KaTeX stylesheet and the body fragment, with no external script tags", () => {
    const doc = buildTutorHtmlDocument("<p>hola</p>", { foreground: "#111111" });
    expect(doc).toContain(".katex");
    expect(doc).toContain("<p>hola</p>");
    expect(doc).toContain("#111111");
    expect(doc).not.toMatch(/<script/i);
  });
});
