#!/usr/bin/env node
/**
 * SPIKE F0.5 (ingestion memory gate) — build script for the WebView bundle.
 *
 * THROWAWAY, __DEV__-only, per
 * docs/plan-app-multiplataforma/especificaciones/C-cliente-e-ingesta.md §2.
 * Deleted along with the rest of `spike-f05/` once the spike's verdict
 * lands.
 *
 * What this does (run manually — `node spike-f05/build.mjs` from
 * `apps/mobile`, or `npm run build:spike-webview` — before starting Metro,
 * and again any time `webview-src/entry.ts` or a source PDF changes):
 *
 * 1. esbuild-bundles `apps/harness/lib/pdf/worker-entry.ts` (unmodified,
 *    REUSE not rewrite) to a single self-contained ESM string — this is
 *    the REAL pdf.js worker script + the Math.sumPrecise polyfill, spawned
 *    later from a `blob:` URL (see webview-src/entry.ts's Worker patch
 *    docblock for why).
 * 2. esbuild-bundles `webview-src/entry.ts` (our driver, which imports
 *    `parsePdf`/`classifyPage`/`ingestPdfTiered` straight from
 *    `apps/harness/lib/pdf/`), injecting (1)'s text via esbuild `define`
 *    as `__WORKER_BUNDLE_SOURCE__`.
 * 3. base64-encodes whichever of `docs/guia1.pdf` (required) and the
 *    optional secondary PDFs (`docs/guiaVA3.pdf`, `docs/guiaINEC2.pdf`,
 *    `docs/prosa-bio.pdf`, §2.3) are present on disk.
 * 4. Wraps (2) in a minimal HTML document and writes EVERYTHING —
 *    HTML+JS+base64 PDFs — to `generated/spike-webview.generated.ts` as
 *    plain JS string/object literals (via JSON.stringify, so no escaping
 *    surprises), imported directly by `app/dev/spike-f05.tsx`.
 *
 * WHY THE OUTPUT IS GENERATED, NOT HAND-WRITTEN OR ASSET-LOADED:
 * `WebView`'s `source={{ html }}` needs a plain JS string at the call
 * site — Metro doesn't run a bundler step over `.html` files the way it
 * does `.ts`, so "compile TS + embed a binary PDF into an importable
 * module" has to happen as an explicit pre-step, not implicitly at Metro
 * bundle time. This is the same shape as any other codegen step (e.g. a
 * GraphQL codegen) — checked-in SOURCE, generated OUTPUT.
 *
 * WHY `generated/` IS GITIGNORED: the output embeds the raw bytes of
 * `docs/guia1.pdf` (and friends) as base64 — those source PDFs are
 * deliberately untracked in git (per the run's hard rules: "do not stage
 * docs/*.pdf|*.txt"). Committing a base64 copy of the same bytes under a
 * different filename would defeat that. Regenerate locally before running
 * the spike; the build script is the checked-in, reproducible part.
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, ".."); // apps/mobile
const appsRoot = path.resolve(mobileRoot, ".."); // apps
const repoRoot = path.resolve(appsRoot, ".."); // repo root
const harnessPdfDir = path.join(appsRoot, "harness", "lib", "pdf");
const docsDir = path.join(repoRoot, "docs");
const generatedDir = path.join(__dirname, "generated");

const SPIKE_BASE_URL = "https://buxo-spike.local/";

/** guia1.pdf is required (spec §2.3 gate file); the rest are optional secondary coverage, run only after guia1.pdf's verdict per §2.3. */
const PDF_FILES = ["guia1.pdf", "guiaVA3.pdf", "guiaINEC2.pdf", "prosa-bio.pdf"];

async function bundleToText(entryPoint, extraOptions = {}) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    write: false,
    absWorkingDir: repoRoot,
    logLevel: "warning",
    ...extraOptions,
  });
  const out = result.outputFiles?.find((f) => f.path.endsWith(".js")) ?? result.outputFiles?.[0];
  if (!out) throw new Error(`build.mjs: esbuild produced no output for ${entryPoint}`);
  return out.text;
}

function readPdfManifest() {
  const manifest = {};
  const found = [];
  const missing = [];
  for (const name of PDF_FILES) {
    const p = path.join(docsDir, name);
    if (existsSync(p)) {
      const bytes = readFileSync(p);
      manifest[name] = bytes.toString("base64");
      found.push(`${name} (${bytes.length} bytes)`);
    } else {
      missing.push(name);
    }
  }
  if (!manifest["guia1.pdf"]) {
    throw new Error(
      `build.mjs: docs/guia1.pdf not found at ${path.join(docsDir, "guia1.pdf")} — this is the required gate file (spec §2.3), cannot build the spike bundle without it.`,
    );
  }
  return { manifest, found, missing };
}

/** Defends against the bundled JS containing a literal `</script` substring (e.g. inside a string/comment) which would prematurely close our inline `<script>` tag when the WebView parses this as HTML. */
function escapeScriptClose(js) {
  return js.replace(/<\/script/gi, "<\\/script");
}

function buildHtmlDocument(mainBundleJs) {
  mainBundleJs = escapeScriptClose(mainBundleJs);
  // Deliberately minimal: a plain-text log region (visible if the WebView
  // is ever inspected directly) plus the bundled module script. No CSS
  // frameworks, no external resources — everything is inline, zero network
  // fetches (baseUrl exists only so relative `new URL(...)` construction
  // inside lib/pdf/parse.ts doesn't throw; nothing is ever actually
  // fetched from it, see webview-src/entry.ts's Worker patch docblock).
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>buxo SPIKE F0.5 (throwaway, __DEV__ only)</title>
<style>
  body { margin: 0; padding: 8px; font-family: monospace; font-size: 11px; background: #111; color: #0f0; }
</style>
</head>
<body>
<div id="spike-marker">SPIKE F0.5 WebView bridge — ready</div>
<script type="module">
${mainBundleJs}
</script>
</body>
</html>`;
}

async function main() {
  console.log("SPIKE F0.5 build: bundling worker-entry.ts (real pdf.js worker + Math.sumPrecise polyfill)...");
  const workerEntryPath = path.join(harnessPdfDir, "worker-entry.ts");
  const workerBundleText = await bundleToText(workerEntryPath);
  console.log(`  -> ${(workerBundleText.length / 1024).toFixed(1)} KB`);

  console.log("SPIKE F0.5 build: bundling webview-src/entry.ts (driver: parsePdf/classifyPage/ingestPdfTiered + bridge)...");
  const entryPath = path.join(__dirname, "webview-src", "entry.ts");
  const mainBundleText = await bundleToText(entryPath, {
    define: {
      __WORKER_BUNDLE_SOURCE__: JSON.stringify(workerBundleText),
    },
  });
  console.log(`  -> ${(mainBundleText.length / 1024).toFixed(1)} KB`);

  console.log("SPIKE F0.5 build: reading docs/*.pdf (untracked by design, read from disk only)...");
  const { manifest, found, missing } = readPdfManifest();
  for (const f of found) console.log(`  + ${f}`);
  for (const m of missing) console.log(`  - ${m} (not present, skipped — optional secondary coverage per §2.3)`);

  const html = buildHtmlDocument(mainBundleText);

  mkdirSync(generatedDir, { recursive: true });
  const outPath = path.join(generatedDir, "spike-webview.generated.ts");
  const contents = `/**
 * AUTO-GENERATED by spike-f05/build.mjs — DO NOT EDIT BY HAND.
 * Regenerate: \`node spike-f05/build.mjs\` from apps/mobile (or \`npm run
 * build:spike-webview\`). Gitignored on purpose — see build.mjs docblock
 * ("WHY generated/ IS GITIGNORED").
 *
 * Built at: ${new Date().toISOString()}
 */
export const SPIKE_BASE_URL = ${JSON.stringify(SPIKE_BASE_URL)};
export const SPIKE_WEBVIEW_HTML = ${JSON.stringify(html)};
export const SPIKE_PDF_MANIFEST${": Record<string, string>"} = ${JSON.stringify(manifest)};
export const SPIKE_BUILD_INFO = ${JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      workerBundleBytes: workerBundleText.length,
      mainBundleBytes: mainBundleText.length,
      pdfsIncluded: Object.keys(manifest),
    },
    null,
    2,
  )};
`;
  writeFileSync(outPath, contents, "utf8");
  console.log(`SPIKE F0.5 build: wrote ${outPath} (${(contents.length / 1024).toFixed(1)} KB total)`);
}

main().catch((err) => {
  console.error("SPIKE F0.5 build FAILED:", err);
  process.exit(1);
});
