/**
 * Home screen (P4) — pure logic for the subject-card grid + the XP display,
 * factored out of `app/courses/index.tsx` for the same reason P3's
 * `lib/onboard*.ts` did: screens import react-native/expo-router and sit
 * outside `vitest.config.ts`'s test surface, so anything worth asserting on
 * lives here instead.
 *
 * **Subject.status deviation from the plan (flagged, not silently
 * papered over):** `01-modelo-datos.md` §1.1 says `Subject` gains a
 * `status: empty|configuring|configured` FIELD. P0/P1 never added it
 * (`@buxo/domain/subject.ts` has no such field — confirmed by reading the
 * module before writing this). Rather than invent a migration P4's file
 * list doesn't authorize, `deriveSubjectStatus` DERIVES the same two
 * observable states from the `Temario` the client already fetches:
 * `"empty"` (no temario yet, or one with zero topics) and `"configured"`
 * (>=1 topic). There is no real signal today for a THIRD, transient
 * `"configuring"` state (e.g. "the AI is generating right now") outside of
 * an in-flight `generateTemario` call the caller already knows about
 * locally — so this module doesn't fabricate one. CONFIRMAR FOUNDER: is a
 * persisted `Subject.status` worth a migration later, or is derivation
 * from `Temario` sufficient long-term?
 *
 * **D2 addition — hero card selection + per-subject progress, ZERO new API
 * calls.** The home screen already fetches every subject's full `Temario`
 * (one `getTemario` call per subject, `app/courses/index.tsx`'s effect) to
 * compute `currentTopicTitle` above — `Tema.status`/`Tema.stars` are right
 * there in that same payload (`packages/domain/temario.ts`), already
 * antifuga-gated server-side (`projectTemarioVisibility`). So `doneCount`/
 * `starsTotal` below are DERIVED from data this module already receives,
 * not a new fetch. `deriveTemarioProgress` (doneCount/total/percent) is
 * reused as-is from `./skillTree` (D3's SkillTree needs the exact same
 * "done topics out of total" computation for its header progress bar) —
 * not reimplemented here.
 */
import type { Subject, Temario, TemarioWithVisibility } from "./api/types";
import { deriveTemarioProgress } from "./skillTree";

export type SubjectCardStatus = "empty" | "configured";

export interface SubjectCardData {
  subject: Subject;
  status: SubjectCardStatus;
  topicCount: number;
  /** Topics with `status === "done"` — 0 for an empty/missing temario. */
  doneCount: number;
  /** Sum of every topic's `stars` (0-3 each) — 0 for an empty/missing temario or when every topic is unstarred. */
  starsTotal: number;
  /** Title of the recommended topic if any, else the first not-yet-done topic — null when there's nothing to point at (empty temario, or every topic done). */
  currentTopicTitle: string | null;
  /**
   * C2-e — the temario's seed material is in ENGLISH while the student
   * studies in Spanish: `seedMaterialLang === "en"` (the book behind the
   * temario) with a real seed catalog key, from the SAME `getTemario`
   * payload the home screen already fetches per subject — no new call.
   *
   * Why there is no "user's UI language" check in the derivation: C2-a
   * freezes `Subject.seedLang` from `users.preferredLanguageCode` WITHOUT
   * looking at the catalog's sources, so an `en` user always resolves an
   * `en` source (`seedMaterialLang === "en"` trivially) and the note would
   * say the obvious — for them the flag still comes out `true`, but their
   * home copy is English too, so `t.subject.materialInEnglish` reads as
   * plain information rather than a divergence warning. The only case that
   * actually needs informing is exactly the divergence the server reports:
   * an `es` UI whose only available source is EN-only (e.g.
   * `bachillerato/fisica` — OpenStax "Physics"), the fallback rule shared
   * by `seedAttributionFor`/`seedSourceLangFor`. Filtering on the UI
   * language client-side would add a locale check for a case the server
   * already discriminates; the renderer decides with the locale it has.
   */
  materialInEnglish: boolean;
}

/** No temario, or one with zero topics, reads as "empty" — matches the mockup's `Sin temario aún` copy (assets/home.html). */
export function deriveSubjectStatus(temario: Temario | null): SubjectCardStatus {
  if (!temario || temario.topics.length === 0) return "empty";
  return "configured";
}

function pickCurrentTopicTitle(temario: Temario | null): string | null {
  if (!temario || temario.topics.length === 0) return null;
  const recommended = temario.topics.find((t) => t.recommended);
  if (recommended) return recommended.title;
  const sorted = [...temario.topics].sort((a, b) => a.order - b.order);
  const nextUp = sorted.find((t) => t.status !== "done");
  return nextUp?.title ?? null;
}

function sumStars(topics: readonly { stars: number }[]): number {
  return topics.reduce((total, topic) => total + topic.stars, 0);
}

/**
 * The temario the home screen receives is `TemarioWithVisibility`
 * (C2-d/C2-e added the seed fields to that same response), but the seed
 * fields are OPTIONAL here so plain-`Temario` callers (and existing tests)
 * keep compiling — absent fields degrade to `materialInEnglish: false`,
 * same "no dato → no nota" rule the XP display follows.
 */
type TemarioWithSeed = Temario & Partial<Pick<TemarioWithVisibility, "seedCatalogKey" | "seedMaterialLang">>;

export function buildSubjectCard(subject: Subject, temario: TemarioWithSeed | null): SubjectCardData {
  const topics = temario?.topics ?? [];
  const progress = deriveTemarioProgress(topics);
  return {
    subject,
    status: deriveSubjectStatus(temario),
    topicCount: progress.total,
    doneCount: progress.doneCount,
    starsTotal: sumStars(topics),
    currentTopicTitle: pickCurrentTopicTitle(temario),
    materialInEnglish: temario?.seedMaterialLang === "en" && temario?.seedCatalogKey != null,
  };
}

/** `temarios[i]` must correspond to `subjects[i]` — the caller (home screen) fetches them in lockstep with `Promise.all`. */
export function buildSubjectCards(subjects: readonly Subject[], temarios: readonly (TemarioWithSeed | null)[]): SubjectCardData[] {
  return subjects.map((subject, i) => buildSubjectCard(subject, temarios[i] ?? null));
}

// ---------------------------------------------------------------------------
// Hero card selection ("Continuá donde ibas", craft spec §3 D2 item 1)
// ---------------------------------------------------------------------------

/** `doneCount/topicCount` — 0 for an empty temario (avoids NaN), never used to compare across subjects with different `topicCount` in absolute terms. */
function progressRatio(card: SubjectCardData): number {
  return card.topicCount === 0 ? 0 : card.doneCount / card.topicCount;
}

/**
 * Picks ONE subject for the hero card, or `null` when nothing qualifies
 * (caller renders no hero at all — no placeholder, per spec). Decision
 * (documented per the spec's "decide tú, documenta y testea"):
 * 1. Only `"configured"` subjects (a temario with >=1 topic) are eligible —
 *    an "empty" subject has nothing to "continue".
 * 2. Among those, prefer one with VISIBLE PARTIAL progress (some topics
 *    done, not all) — that's the subject a student is mid-way through,
 *    the clearest "continue where you left off" signal.
 * 3. If no subject has partial progress (every configured subject is at
 *    0% or 100%), fall back to the first configured subject in array
 *    order — still "the" subject with a temario, just not one you can
 *    rank by momentum.
 * 4. Ties within the chosen pool keep the FIRST subject at that ratio
 *    (stable left-to-right scan via `reduce`, never re-sorts the array).
 */
export function selectHeroCard(cards: readonly SubjectCardData[]): SubjectCardData | null {
  const configured = cards.filter((c) => c.status === "configured");
  if (configured.length === 0) return null;

  const partial = configured.filter((c) => c.doneCount > 0 && c.doneCount < c.topicCount);
  const pool = partial.length > 0 ? partial : configured;

  return pool.reduce((best, candidate) => (progressRatio(candidate) > progressRatio(best) ? candidate : best));
}

// ---------------------------------------------------------------------------
// XP display — degrade cleanly when the server is in shadow mode
// ---------------------------------------------------------------------------

export interface XpDisplay {
  /** false in shadow mode (server omitted the field) — the caller must render NOTHING numeric, not a 0. */
  visible: boolean;
  total: number;
}

/**
 * `payload.visible` is the field `routes/xp.ts` OMITS in shadow mode
 * (antifuga) — this is the single place that turns "field absent" into
 * "don't show a number" so no screen has to reason about the antifuga
 * mechanics directly. Never throws on a null/malformed payload — a failed
 * or not-yet-loaded XP fetch degrades the same way shadow mode does (no
 * number), which is the "degradación limpia, no crash" the plan requires.
 */
export function deriveXpDisplay(payload: { visible?: number } | null | undefined): XpDisplay {
  if (!payload || typeof payload.visible !== "number") return { visible: false, total: 0 };
  return { visible: true, total: payload.visible };
}
