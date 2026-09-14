/**
 * Sentinel values shared across the domain model. Defined ONCE here and
 * re-exported/reused by every entity module that needs them — never
 * re-literal'd elsewhere in this package.
 *
 * Design context:
 *  - `VERSION_SENTINEL_UNKNOWN_ALPHA_MIGRATED`: B3 §5.2 (migration mapping
 *    table) + §7 invariant I-5. The alfa never persisted per-exchange/
 *    per-assessment model/provider identity (only a session-level
 *    `promptVersion`, and only for the tutor). Any version field backfilled
 *    from alfa data that has no real value uses this sentinel instead of
 *    `null` — I-5 says a null version field on a NEW record is a bug; only
 *    records migrated from the alfa may carry this sentinel.
 *  - `SUBJECT_ROLLUP_TOPIC_KEY`: B3 §2.10 (`MasteryState.topicKey`) +
 *    invariant I-9. `""` is reserved to mean "rollup at the Subject level"
 *    (no specific topic) — confirmed as the exact sentinel string by the
 *    architect's cross-validation (`02-validacion-arquitecto.md`,
 *    "B3↔B2": "sentinela `topicKey: \"\"` ... usado idéntico en ambos").
 */

/** B3 §5.2, §7 I-5. Backfill value for version fields with no reconstructible alfa history. */
export const VERSION_SENTINEL_UNKNOWN_ALPHA_MIGRATED = "unknown-alpha-migrated" as const;

export type VersionSentinel = typeof VERSION_SENTINEL_UNKNOWN_ALPHA_MIGRATED;

/** B3 §2.10, §7 I-9. Reserved `topicKey` meaning "subject-level rollup, not a specific topic". */
export const SUBJECT_ROLLUP_TOPIC_KEY = "" as const;

export type SubjectRollupTopicKey = typeof SUBJECT_ROLLUP_TOPIC_KEY;
