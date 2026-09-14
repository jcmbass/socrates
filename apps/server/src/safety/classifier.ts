/**
 * Input safety classifier — C-backend §3.1. BLOCKING: called before the
 * tutor on every message (§0 decision 7). This module defines the
 * INTERFACE only; the real model-backed implementation (§3.1's "alternativa
 * ... una llamada barata a un modelo con rúbrica fija", @buxo/models' new
 * `"safety"` TaskKind) needs founder spend approval before it can make a
 * real call — out of scope for F1/WP5 per the task's hard rule (zero real
 * API calls). `RuleBasedSafetyClassifier` is the F1 stand-in: deterministic
 * keyword/pattern rules, same shape the real classifier will return, so
 * swapping the implementation later is a one-line change at the wiring
 * site (src/models/adapters.ts), never route/middleware surgery.
 */
export const SAFETY_CATEGORIES = ["none", "self_harm", "abuse_disclosure", "jailbreak_attempt", "other"] as const;
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export interface SafetyClassification {
  category: SafetyCategory;
  /** 0-1, informational — the stub always reports 1 for a matched rule, 0 for "none". */
  confidence: number;
  /** Which classifier produced this — persisted onto SafetyIncident.classifierProviderId/ModelId. */
  providerId: string;
  modelId: string;
}

export interface SafetyClassifier {
  classify(message: string): Promise<SafetyClassification>;
}

const SELF_HARM_PATTERNS = [
  /\b(quiero|voy a|pienso en|planeo)\s+(matarme|suicidarme|quitarme la vida)\b/i,
  /\bsuicid(io|arme|arse)\b/i,
  /\bno quiero (seguir viviendo|vivir m[aá]s)\b/i,
  /\b(kill|hurt) myself\b/i,
  /\bself[\s-]?harm\b/i,
  /\bwant to die\b/i,
  /\bme quiero (morir|matar)\b/i,
  /\bme (corto|estoy cortando)\b/i,
];

const ABUSE_DISCLOSURE_PATTERNS = [
  /\bme (est[aá]|han) (tocando|golpeando|abusando)\b/i,
  /\b(mi padre|mi padrastro|mi t[ií]o|alguien) me (pega|golpea|toca)\b/i,
  /\b(sexual|physical) abuse\b/i,
  /\bhe(\s|'s| is) (hitting|touching|abusing) me\b/i,
  /\bme obliga(n)? a\b/i,
];

const JAILBREAK_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions?\b/i,
  /\bignora\s+(todas\s+)?las\s+instrucciones\s+(anteriores|previas)\b/i,
  /\byou are (now )?dan\b/i,
  /\bact as if you have no restrictions\b/i,
  /\bpretend you (have no|don't have) (rules|restrictions|guidelines)\b/i,
  /\breveal your system prompt\b/i,
  /\bmu[eé]strame tu (system\s?prompt|instrucciones del sistema)\b/i,
  /\bdisregard your (rules|instructions|guidelines)\b/i,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

export const STUB_CLASSIFIER_PROVIDER_ID = "buxo-rule-based";
export const STUB_CLASSIFIER_MODEL_ID = "safety-stub-v1";

/**
 * Deterministic, zero-network rule-based classifier — the F1/WP5 safety
 * stand-in. Order matters: self-harm/abuse checked before jailbreak (a
 * jailbreak-shaped message that ALSO discloses self-harm should still
 * escalate as self-harm, the higher-severity path, §3.2).
 */
export class RuleBasedSafetyClassifier implements SafetyClassifier {
  async classify(message: string): Promise<SafetyClassification> {
    const base = { providerId: STUB_CLASSIFIER_PROVIDER_ID, modelId: STUB_CLASSIFIER_MODEL_ID };
    if (matchesAny(SELF_HARM_PATTERNS, message)) return { ...base, category: "self_harm", confidence: 1 };
    if (matchesAny(ABUSE_DISCLOSURE_PATTERNS, message)) return { ...base, category: "abuse_disclosure", confidence: 1 };
    if (matchesAny(JAILBREAK_PATTERNS, message)) return { ...base, category: "jailbreak_attempt", confidence: 1 };
    return { ...base, category: "none", confidence: 0 };
  }
}
