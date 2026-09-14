/**
 * Table-of-contents localization and parsing — a course's temario is built
 * from a book's INDEX, not from the book's full text
 * (docs/plan-temario-indice/00-plan.md).
 *
 * Pure functions, same discipline as classify.ts: no pdf.js, no DOM, no
 * network, no state. Structures come in as parameters; every function is a
 * total function of its input.
 *
 * ## Why three separate functions instead of one "extract temario" call
 *
 * A founder-diagnosed real failure: a student uploaded a 429-page algorithms
 * textbook expecting a temario; the pipeline tried to read the whole book
 * and failed (`MAX_PAGES_PER_REQUEST` in apps/server/src/raster/limits.ts).
 * The fix is not "raise the page limit" — it's "don't read the book, read
 * its index" (1-2 pages). But a real PDF gives you TWO different, partial
 * signals toward that index, and neither one alone is reliable:
 *
 *   - The PDF's OUTLINE (bookmark tree) sometimes points AT the index page
 *     (`outlineToTocLocator`) — but measured on
 *     `docs/introduction-to-algorithms-cormen-solution-2nd.pdf`, the
 *     outline's own top-level entries are just "Chapter 2", "Chapter 3",
 *     "Chapter 4"... — bare numbers, no names, USELESS as a temario by
 *     themselves (see `__tests__/__fixtures__/toc/algorithms-outline-bare-chapters.json`,
 *     extracted verbatim from that file's real outline: 22 entries, all of
 *     the form "Chapter N"). The REAL chapter names ("Chapter 2: Getting
 *     Started") only exist as printed TEXT on the Contents page (page 3 of
 *     429), which the outline's first entry ("Contents", page 3) points at.
 *     **The outline is the LOCATOR, not the source.**
 *
 *   - Sometimes there is no such locator entry, but the outline itself is
 *     already rich enough to double as a temario candidate without
 *     visiting any page at all — synthesized from
 *     `guia_docente_quimica_general.pdf`'s outline with its own
 *     "IV.- CONTENIDOS" entry removed (`quimica-outline-without-contenidos.json`
 *     fixture): the remaining 9 entries ("I.- IDENTIFICACIÓN",
 *     "II.- OBJETIVOS", "V.- COMPETENCIAS"...) are real section names, not
 *     bare numbers. (The UNMODIFIED real outline actually hits the
 *     LOCATOR case above instead, and correctly so: its own
 *     "IV.- CONTENIDOS" entry literally means "Contents" in Spanish and
 *     points at page 5 — which, verified against the real PDF text, is
 *     exactly where this guide's "PROGRAMA: Tema 1... Tema 10..." syllabus
 *     listing lives. A nice confirmation that the Spanish vocabulary match
 *     isn't just pattern-matching for its own sake.)
 *
 *   - And 6 of the 8 real PDFs sondeados for this phase have NO outline at
 *     all (`calculo-multivariable.pdf`, the four short guías, and the
 *     scanned `The_Distributed_Node.pdf`). For those, the only way to find
 *     an index page is to look at the PAGE CONTENT itself and recognize the
 *     shape of an index (`findTocPages`) — **this is the common path, not
 *     the fallback.** Only 2 of 8 real documents sondeados had any outline
 *     at all.
 *
 * `outlineToTocLocator` therefore never decides FOR the caller whether to
 * trust the outline or go read a page — it only classifies what the
 * outline offers (a page to jump to, a richness signal, or nothing). The
 * caller (a future wave, not this one) picks the path.
 *
 * ## The honest limit (do not build automatic recorte on top of this)
 *
 * A book's index is NOT a course's temario — the index lists everything
 * the book covers; a specific course covers a SUBSET of it (see
 * docs/plan-temario-indice/00-plan.md fase 2 for the product-level
 * decision). `buildTemarioDraft` below deliberately stops at "here is the
 * index, with chapter/section structure" — it does not guess where the
 * student's course stops. That recorte is a product decision that needs a
 * human (the student), not a heuristic.
 */

import type { NormalizedPage, TextItem } from "./types";

// ---------------------------------------------------------------------------
// Shared vocabulary (Spanish + English — buxo serves students in El Salvador
// studying from both local and foreign-language materials, see the 8-PDF
// sondeo: `guia_docente_quimica_general.pdf` is Spanish,
// `introduction-to-algorithms-cormen-solution-2nd.pdf` is English).
// ---------------------------------------------------------------------------

/** Exact-phrase index-header vocabulary, both languages. Deliberately narrow — see `isHeaderLine` for why width matters more than recall here. */
const HEADER_PHRASES = [
  "índice",
  "indice",
  "contenido",
  "contenidos",
  "tabla de contenido",
  "tabla de contenidos",
  "contents",
  "temario",
  "sumario",
] as const;

function normalizeHeaderCandidate(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[:.]+$/, "")
    .replace(/\s+/g, " ");
}

/**
 * A line counts as an index-page HEADER if it's (a) exactly one of the
 * header phrases (e.g. a lone "Contents" line), or (b) a SHORT line (<= 3
 * words) that contains one as a whole word/phrase — this covers the real
 * case measured on `algorithms` page 4, where the running header is "iv
 * Contents" (page-number-of-the-front-matter + header on the same printed
 * line, but pdf.js/mupdf give them back as one text row).
 *
 * Deliberately NOT a substring match on arbitrary-length lines: "índice" is
 * an ordinary Spanish word ("índice de refracción", "índice glucémico")
 * that shows up in normal prose all the time. Restricting the substring
 * check to short lines keeps the header signal precise without needing a
 * position-based "is this a heading" signal we don't have in `parseTocText`
 * (plain text in, no font size/boldness available).
 */
function isHeaderLine(line: string): boolean {
  const norm = normalizeHeaderCandidate(line);
  if ((HEADER_PHRASES as readonly string[]).includes(norm)) return true;
  const words = norm.split(" ").filter((w) => w.length > 0);
  if (words.length === 0 || words.length > 3) return false;
  return words.some((w) => (HEADER_PHRASES as readonly string[]).includes(w));
}

/**
 * A standalone page-number-shaped token. Three deliberately DIFFERENT case
 * rules, not one case-insensitive regex — measured false positive on
 * `calculo-multivariable.pdf` page 1: the line "MATEMÁTICA III" ends in
 * "III", which IS a valid roman numeral, but it's a course-code suffix, not
 * a page number. Real printed front-matter roman-numeral pagination is
 * conventionally LOWERCASE (i, ii, iii, iv...); course/chapter titles that
 * happen to end in a roman numeral are conventionally UPPERCASE. Requiring
 * lowercase for the bare-roman-numeral branch fixes that false positive
 * without giving up the real front-matter case (`algorithms` page 3's
 * "R-1", "P-1", "2-16" tokens still match via the other two branches).
 */
function isPageNumberToken(token: string): boolean {
  if (/^[ivxlcdm]+$/.test(token)) return true; // lowercase roman numerals only
  if (/^[A-Za-z]{1,3}-\d+$/.test(token)) return true; // "R-1", "P-1", "I-1"
  if (/^\d+(-\d+)?$/.test(token)) return true; // "42", "2-16"
  return false;
}

/** "Chapter 2: ..." / "Capítulo 3 ..." / "Tema 5: ..." at the start of a line — the chapter-marker signal, both languages. */
const CHAPTER_LINE_RE = /^(chapter|cap[ií]tulo|unidad|unit|tema|secci[oó]n|section)\s+\d+\b/i;

/**
 * "1.2 Título" / "1.2.3 Título" MULTI-LEVEL hierarchical numbering — used
 * by `scoreTocPage`'s `hierarchicalNumberingRatio` signal specifically
 * because it requires >= 1 dot segment, so it does NOT fire on an ordinary
 * numbered list item ("13) Resolver...", "1) ...") the way a bare `^\d+`
 * check would (measured: `guia1.pdf`/`guiaINEC2.pdf`'s numbered problem
 * lists must NOT read as "structured index numbering").
 */
const HIERARCHICAL_NUMBERING_RE = /^\d+(\.\d+)+\b/;

/**
 * Same idea as `HIERARCHICAL_NUMBERING_RE` but for `inferLevel`, where a
 * BARE top-level number ("1 Introducción", no dot) legitimately means
 * level 1, not "not hierarchical" — deliberately a separate, more
 * permissive regex rather than loosening `HIERARCHICAL_NUMBERING_RE`
 * itself, which would let plain numbered-list items inflate
 * `hierarchicalNumberingRatio` above (see that regex's own doc).
 */
const LEVEL_NUMBER_PREFIX_RE = /^(\d+(?:\.\d+)*)(?=[\s):.]|$)/;

const DOT_LEADER_RE = /\.{3,}/;

// ---------------------------------------------------------------------------
// 1. findTocPages — does this page LOOK like a printed index?
// ---------------------------------------------------------------------------

export interface TocPageSignals {
  /** A recognizable "Índice"/"Contents"/etc. header appears in the first few lines. */
  headerMatch: boolean;
  /** Fraction of (non-header) lines whose last token is page-number-shaped. */
  pageNumberPairRatio: number;
  /** Among consecutive PURE-integer page-number tokens found, fraction of adjacent pairs that are non-decreasing. */
  ascendingRunRatio: number;
  /** Fraction of lines with <= 6 words — index entries are short. */
  shortLineDensity: number;
  /** Fraction of lines starting with a chapter marker or hierarchical numbering. */
  hierarchicalNumberingRatio: number;
  /** Fraction of lines containing a run of 3+ dots (classic dot-leader TOC formatting). */
  dotLeaderRatio: number;
  lineCount: number;
}

export interface TocPageCandidate {
  pageNumber: number;
  confidence: number;
  signals: TocPageSignals;
}

/**
 * `confidence = clamp01(0.4*headerMatch + 0.25*pageNumberPairRatio
 *                      + 0.15*ascendingRunRatio + 0.1*shortLineDensity
 *                      + 0.05*hierarchicalNumberingRatio + 0.05*dotLeaderRatio)`
 *
 * Weights, in order (same "most reliable signal gets the most weight"
 * principle as classify.ts's formulaScore):
 *
 * - headerMatch (0.4, the single largest term): an explicit "Índice" /
 *   "Contents" heading is the closest thing to ground truth a plain-text
 *   heuristic gets. Not decisive alone (0.4 < threshold) because running
 *   headers can coincidentally contain the word (see `isHeaderLine`'s doc),
 *   but it should dominate when paired with even a modest second signal.
 * - pageNumberPairRatio (0.25): the defining STRUCTURAL feature of an
 *   index — lines that name something and point at a page. Second-largest
 *   because unlike the header word, it can't appear by accident at this
 *   magnitude (measured: prose pages score 0.0-0.03 on this signal;
 *   `algorithms` pages 3/4 score ~0.68).
 * - ascendingRunRatio (0.15): real signal (an index's page numbers only
 *   go up) but weak in practice against real books — chapter-relative
 *   numbering ("2-1", "2-16") isn't a single global sequence, so this
 *   signal mostly fires 0 on real front-matter-style indices and only
 *   helps on a flat, single-sequence index (tested with a synthetic
 *   fixture, see toc.test.ts).
 * - shortLineDensity (0.1) and hierarchicalNumberingRatio (0.05): both
 *   also fire on OTHER short/numbered content (title slides, numbered
 *   problem sets — measured `guia1.pdf`/`guiaINEC2.pdf` at 0.17-0.19
 *   total), so they're kept small, tie-breaker weight only.
 * - dotLeaderRatio (0.05): real but RARE in extracted text — modern PDF
 *   text extraction often linearizes dot leaders away (none of the 8
 *   sondeo PDFs' extracted text contained literal dot runs, even
 *   `algorithms`' visually-dot-leadered Contents pages). Kept for PDFs
 *   that do preserve them, but can't be relied on as a primary signal.
 *
 * Threshold calibrated against all 8 sondeo PDFs (see toc.test.ts): the two
 * real TOC pages scored 0.68 and 0.68; the worst false-positive-prone
 * negative (a numbered-list problem set with fragmented glyphs) scored
 * 0.19. `DEFAULT_TOC_CONFIDENCE_THRESHOLD = 0.45` sits with wide margin on
 * both sides of that real gap — and DELIBERATELY above headerMatch's own
 * 0.4 weight, so a header keyword alone is never enough by itself. Caught
 * by a mutation-style test that failed on first write: "Índice de
 * refracción" is a completely ordinary physics-textbook section heading
 * (word "índice" is common Spanish vocabulary, not exclusively a TOC
 * marker — see `isHeaderLine`'s own doc) — a threshold at or below 0.4
 * would flag any such short heading as an index page on the header word
 * alone, with zero structural corroboration.
 */
export const DEFAULT_TOC_CONFIDENCE_THRESHOLD = 0.45;

const ROW_Y_TOLERANCE = 3;
/** Lines at or below this word count count toward `shortLineDensity`. */
const SHORT_LINE_WORD_MAX = 6;
/** Only the first N lines of a page are checked for `headerMatch` — an index's own heading is always near its top. */
const HEADER_SEARCH_WINDOW = 6;

interface ReconstructedLine {
  y: number;
  text: string;
}

/** Groups text items into visual rows by y-proximity, same tolerance/approach as pageText.ts's groupIntoLines, kept as its own copy here because the two modules answer different questions from a line (reading-order markdown vs. TOC-shape signals) — same "each module owns its own line-detection needs" pattern already used between classify.ts and pageText.ts. */
function reconstructLines(textItems: TextItem[]): ReconstructedLine[] {
  const sorted = [...textItems].sort((a, b) => b.y - a.y);
  const rows: TextItem[][] = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) <= ROW_Y_TOLERANCE);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows
    .map((items) => {
      const ordered = [...items].sort((a, b) => a.x - b.x);
      const text = ordered
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const avgY = items.reduce((sum, i) => sum + i.y, 0) / items.length;
      return { y: avgY, text };
    })
    .filter((l) => l.text.length > 0);
}

/** Scores a single page. Exposed (not just used internally) so a caller/test can inspect any page's raw signals, not only the ones that clear the threshold. */
export function scoreTocPage(page: NormalizedPage): TocPageCandidate {
  const lines = reconstructLines(page.textItems);
  if (lines.length === 0) {
    return {
      pageNumber: page.pageNumber,
      confidence: 0,
      signals: {
        headerMatch: false,
        pageNumberPairRatio: 0,
        ascendingRunRatio: 0,
        shortLineDensity: 0,
        hierarchicalNumberingRatio: 0,
        dotLeaderRatio: 0,
        lineCount: 0,
      },
    };
  }

  const headerMatch = lines.slice(0, HEADER_SEARCH_WINDOW).some((l) => isHeaderLine(l.text));

  let pairHits = 0;
  let considered = 0;
  let shortLines = 0;
  let hierHits = 0;
  let dotHits = 0;
  const pureIntTokens: number[] = [];

  for (const line of lines) {
    if (isHeaderLine(line.text)) continue;
    considered += 1;
    const tokens = line.text.split(" ");
    const last = tokens[tokens.length - 1];
    if (isPageNumberToken(last)) {
      pairHits += 1;
      if (/^\d+$/.test(last)) pureIntTokens.push(Number(last));
    }
    if (tokens.length <= SHORT_LINE_WORD_MAX) shortLines += 1;
    if (CHAPTER_LINE_RE.test(line.text) || HIERARCHICAL_NUMBERING_RE.test(line.text)) hierHits += 1;
    if (DOT_LEADER_RE.test(line.text)) dotHits += 1;
  }

  const pageNumberPairRatio = considered === 0 ? 0 : pairHits / considered;
  const shortLineDensity = considered === 0 ? 0 : shortLines / considered;
  const hierarchicalNumberingRatio = considered === 0 ? 0 : hierHits / considered;
  const dotLeaderRatio = considered === 0 ? 0 : dotHits / considered;

  let ascendingOk = 0;
  let ascendingTotal = 0;
  for (let i = 1; i < pureIntTokens.length; i++) {
    ascendingTotal += 1;
    if (pureIntTokens[i] >= pureIntTokens[i - 1]) ascendingOk += 1;
  }
  const ascendingRunRatio = ascendingTotal === 0 ? 0 : ascendingOk / ascendingTotal;

  const confidence = Math.max(
    0,
    Math.min(
      1,
      0.4 * (headerMatch ? 1 : 0) +
        0.25 * pageNumberPairRatio +
        0.15 * ascendingRunRatio +
        0.1 * shortLineDensity +
        0.05 * hierarchicalNumberingRatio +
        0.05 * dotLeaderRatio,
    ),
  );

  return {
    pageNumber: page.pageNumber,
    confidence,
    signals: {
      headerMatch,
      pageNumberPairRatio,
      ascendingRunRatio,
      shortLineDensity,
      hierarchicalNumberingRatio,
      dotLeaderRatio,
      lineCount: lines.length,
    },
  };
}

/**
 * Scores every page and returns only those clearing `threshold`, in
 * page-number order (a printed index commonly spans 2+ consecutive pages —
 * measured on `algorithms`, whose Contents runs pages 3-4).
 */
export function findTocPages(
  pages: NormalizedPage[],
  threshold: number = DEFAULT_TOC_CONFIDENCE_THRESHOLD,
): TocPageCandidate[] {
  return pages
    .map(scoreTocPage)
    .filter((c) => c.confidence >= threshold)
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

// ---------------------------------------------------------------------------
// 2. outlineToTocLocator — what does the PDF's own bookmark tree offer?
// ---------------------------------------------------------------------------

/** A flattened bookmark/outline entry. Resolving a pdf.js `dest` down to a page number is the glue layer's job (I/O); this module only ever sees the resolved `pageNumber`. */
export interface OutlineEntry {
  level: number;
  title: string;
  pageNumber: number;
}

export type TocLocator =
  | { kind: "toc-page"; pageNumber: number; matchedTitle: string }
  | { kind: "outline-rich"; entryCount: number }
  | { kind: "none" };

/** "Chapter 2" / "Capítulo 3" / "Chapter 2:" with NOTHING descriptive after the number — the founder's exact diagnosed case: `algorithms-outline-bare-chapters.json`'s 22 real entries are all this shape. */
const VAGUE_CHAPTER_ONLY_RE = /^(chapter|cap[ií]tulo|unidad|unit|tema|secci[oó]n|section)\s+\d+\s*:?\s*$/i;

/** An outline needs at least this many entries before "richness" is even worth asking about — 1-2 entries isn't a temario candidate regardless of how descriptive they are. */
const MIN_OUTLINE_ENTRIES_FOR_RICHNESS = 3;
/** At least half the entries must carry a real name, not just a bare number, to call the outline "rich" — a plain majority, not a supermajority: the quimica-without-locator-entry fixture clears this at 9/9; the founder's bare-chapters fixture fails it at 0/22. */
const RICHNESS_NON_VAGUE_RATIO = 0.5;

function isVagueChapterOnly(title: string): boolean {
  return VAGUE_CHAPTER_ONLY_RE.test(title.trim());
}

/**
 * Classifies what the outline offers, WITHOUT deciding how to use it — see
 * this module's top-of-file doc for why that decision is left to the
 * caller. Order of checks:
 *
 *   1. An entry whose title IS a Contents/Índice header, anywhere in the
 *      tree — the LOCATOR case (measured on `algorithms`: entry 1 is
 *      literally `{title: "Contents", pageNumber: 3}`; also measured on
 *      the REAL, unmodified `guia_docente_quimica_general.pdf` outline,
 *      whose own "IV.- CONTENIDOS" entry matches and correctly points at
 *      page 5). Returned even if later checks would also pass — a page
 *      you can jump to and read beats an inference from bookmark text
 *      alone.
 *   2. Otherwise, if the outline itself is descriptive enough
 *      (`isVagueChapterOnly` minority), report it as a usable-but-unverified
 *      candidate (`outline-rich`).
 *   3. Otherwise `none` — either no outline, or a bare-numbers-only outline
 *      like `algorithms`' own top-level chapters.
 */
export function outlineToTocLocator(outline: OutlineEntry[]): TocLocator {
  if (outline.length === 0) return { kind: "none" };

  const localizerEntry = outline.find((e) => isHeaderLine(e.title));
  if (localizerEntry) {
    return {
      kind: "toc-page",
      pageNumber: localizerEntry.pageNumber,
      matchedTitle: localizerEntry.title.trim(),
    };
  }

  const nonVagueCount = outline.filter((e) => !isVagueChapterOnly(e.title)).length;
  const richEnough =
    outline.length >= MIN_OUTLINE_ENTRIES_FOR_RICHNESS &&
    nonVagueCount / outline.length >= RICHNESS_NON_VAGUE_RATIO;
  if (richEnough) {
    return { kind: "outline-rich", entryCount: outline.length };
  }

  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// 3. parseTocText — structure the text of ONE index page
// ---------------------------------------------------------------------------

export interface TocEntry {
  title: string;
  /**
   * Raw page-number token AS PRINTED — "42", "2-16", "iv", "I-1". Kept as a
   * string on purpose: a book's numbering is not one global integer
   * sequence (front matter is roman, each chapter's lecture notes restart
   * at "N-1" — measured on `algorithms`). Parsing this into a jumpable
   * integer is a DIFFERENT, harder problem (which physical PDF page does
   * "2-16" correspond to?) left to a future wave, not invented here.
   */
  pageNumber: string | null;
  level: number;
}

/** A line that's ONLY a page-number token — the real `algorithms` page-4 pairing case ("Lecture Notes" / "2-1" arrive as separate output lines from plain-text extraction even though pdf.js/mupdf places them on the same visual row — see this module's top-of-file doc). */
function isBarePageNumberLine(line: string): boolean {
  return isPageNumberToken(line.trim());
}

/**
 * Best-effort level inference from TEXT ALONE (no x/y available at this
 * stage — `parseTocText` takes a plain string, per spec). Two strong,
 * unambiguous signals get honored; anything else defaults to level 2.
 * KNOWN LIMITATION (documented, not silently swallowed): a plain title like
 * "Index" at the very end of a chapter listing has neither signal and so
 * is misclassified as a level-2 sub-entry of the preceding chapter rather
 * than its own top-level entry — see toc.test.ts's real fixture for this
 * exact case. Fixing it needs POSITION data (indentation), which this
 * function doesn't have; `findTocPages` operates on positioned data and
 * could carry that forward in a later wave, not this one.
 */
function inferLevel(title: string): number {
  const numberMatch = title.match(LEVEL_NUMBER_PREFIX_RE);
  if (numberMatch) {
    return numberMatch[1].split(".").length;
  }
  if (CHAPTER_LINE_RE.test(title)) return 1;
  return 2;
}

const SAME_LINE_DOT_LEADER_RE = /^(.+?)\s*\.{2,}\s*([ivxlcdm]+|[A-Za-z]{1,3}-\d+|\d+(?:-\d+)?)$/i;

/**
 * Parses the text of ONE index page into a flat, ordered list of entries.
 * For a multi-page index (`algorithms`' Contents runs pages 3-4), call this
 * once per page (in page order) and concatenate the results — kept
 * per-page rather than accepting a joined string so a caller only pays for
 * exactly the pages `findTocPages`/`outlineToTocLocator` told it to read.
 *
 * Handles two real, measured shapes:
 *   1. Same-line dot-leader: "Title .......... 42" (not observed in any of
 *      the 8 sondeo PDFs' extracted text, but a documented real TOC
 *      convention some PDF text extractors DO preserve).
 *   2. Title and page number on SEPARATE lines (the one actually measured,
 *      verbatim, on `algorithms` pages 3-4 via pymupdf's `get_text()`):
 *      "Chapter 2: Getting Started" / "Lecture Notes" / "2-1" — the title
 *      line has no number of its own; its first CHILD line ("Lecture
 *      Notes") is immediately followed by a bare page-number line ("2-1")
 *      that gets paired with IT, not with the chapter title. This is
 *      correct, not a bug: in the source book, "Chapter 2: Getting
 *      Started" genuinely has no single page number of its own — "Lecture
 *      Notes" (2-1) and "Solutions" (2-16) are its two distinct sections.
 */
export function parseTocText(text: string): TocEntry[] {
  const rawLines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  const entries: TocEntry[] = [];

  // Leading noise: a running header ("Contents") and/or a bare front-matter
  // page number ("iv") can appear before the first real entry — measured
  // verbatim on `algorithms` page 4 (`"iv\nContents\n..."`). Only strip
  // this BEFORE the first entry is found; a header/number appearing later
  // in a real list is handled by the per-line checks below instead.
  let i = 0;
  while (i < rawLines.length && (isHeaderLine(rawLines[i]) || isBarePageNumberLine(rawLines[i]))) {
    i++;
  }

  while (i < rawLines.length) {
    const line = rawLines[i];

    if (isHeaderLine(line)) {
      i++;
      continue;
    }

    const dotLeaderMatch = line.match(SAME_LINE_DOT_LEADER_RE);
    if (dotLeaderMatch) {
      const title = dotLeaderMatch[1].replace(/\.+\s*$/, "").trim();
      const pageNumber = dotLeaderMatch[2];
      entries.push({ title, pageNumber, level: inferLevel(title) });
      i++;
      continue;
    }

    const next = rawLines[i + 1];
    if (next !== undefined && isBarePageNumberLine(next)) {
      entries.push({ title: line, pageNumber: next.trim(), level: inferLevel(line) });
      i += 2;
      continue;
    }

    entries.push({ title: line, pageNumber: null, level: inferLevel(line) });
    i += 1;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 4. buildTemarioDraft — structure entries into chapters/sections
// ---------------------------------------------------------------------------

export interface TemarioSection {
  title: string;
  pageNumber: string | null;
  level: number;
}

export interface TemarioChapter {
  title: string;
  pageNumber: string | null;
  sections: TemarioSection[];
}

/**
 * The output of this phase. **This is an INDEX, not a temario** — see this
 * module's top-of-file doc. `chapters`/`sections` mirror exactly what the
 * book's own index says exists, with nothing added and nothing cut down to
 * "what the course actually covers". A future wave (explicitly out of
 * scope here, per the architect's mandate — no automatic recorte) is
 * responsible for letting the student mark where their course stops.
 */
export interface TemarioDraft {
  chapters: TemarioChapter[];
  /** Level >= 2 entries that appeared before any level-1 entry opened a chapter — kept, not dropped, so the caller can see and handle them instead of silently losing data. */
  orphanSections: TemarioSection[];
}

/**
 * Groups a flat `TocEntry[]` (as produced by `parseTocText`, one or more
 * pages concatenated in page order) into chapters/sections by `level`:
 * every level-1 entry opens a new chapter; every level>=2 entry becomes a
 * section of the most recently opened chapter.
 */
export function buildTemarioDraft(entries: TocEntry[]): TemarioDraft {
  const chapters: TemarioChapter[] = [];
  const orphanSections: TemarioSection[] = [];

  for (const entry of entries) {
    if (entry.level <= 1) {
      chapters.push({ title: entry.title, pageNumber: entry.pageNumber, sections: [] });
      continue;
    }
    const section: TemarioSection = { title: entry.title, pageNumber: entry.pageNumber, level: entry.level };
    const currentChapter = chapters[chapters.length - 1];
    if (currentChapter) currentChapter.sections.push(section);
    else orphanSections.push(section);
  }

  return { chapters, orphanSections };
}
