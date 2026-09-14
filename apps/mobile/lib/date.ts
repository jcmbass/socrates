/**
 * Date display helper. Deliberately avoids `toLocaleDateString`/Intl:
 * Hermes's Intl coverage on Android is uneven (DF-5.1 caution). Pure,
 * unit-tested.
 *
 * A1 — parametrized by locale: `es` renders dd/mm/yyyy (the universal
 * Salvadoran convention), `en` renders mm/dd/yyyy. Callers pass the active
 * locale (`useT()`-consuming components read it from `useLocale()`); the
 * default keeps every caller pre-migration rendering exactly as before.
 */

import type { Locale } from "../i18n";

/** ISO timestamp → "14/07/2026" (es) / "07/14/2026" (en). Invalid input → "". */
export function formatShortDate(iso: string, locale: Locale = "es"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return locale === "en" ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
}
