/**
 * Policy version identifiers — C5 (R-8): single source of truth for which
 * version of the legal documents is currently active.
 *
 * Versión ACTIVA, servida por el propio servidor:
 *   - "terms-2026-09-v2"   → GET /legal/terminos
 *     (responsable cubo.lat sin figura jurídica; borrado in-app)
 *   - "privacy-2026-09-v4" → GET /legal/privacidad
 *     (mismo responsable; atribución de modelos: gemma=Google,
 *     DeepSeek=DeepSeek, Qwen=Alibaba; botón de borrado in-app)
 *   Texto en `apps/server/src/legal/documents.ts` (fuente única).
 *
 * Versiones ANTERIORES, archivadas — son las que aceptaron los usuarios
 * registrados antes de la versión vigente, y por eso sus archivos NO se
 * editan ni se borran:
 *   - "terms-2026-07-v1-draft"   → docs/legal/terminos-v1-DRAFT.md
 *   - "privacy-2026-07-v1-draft" → docs/legal/privacidad-v1-DRAFT.md
 *   - "privacy-2026-08-v1"       → docs/legal/privacidad-2026-08-v1.md
 *     (texto servido entre 2026-08-06 y 2026-08-11 — tabla de proveedores
 *     con Ollama como tutor; DeepInfra solo transcribía material)
 *   - "privacy-2026-08-v2"       → docs/legal/privacidad-2026-08-v2.md
 *     (texto servido entre 2026-08-11 (F3) y 2026-08-11 (dos modelos) —
 *     tutor/temario/ingesta en DeepInfra; assessor/judge aún en Anthropic)
 *   - "privacy-2026-08-v3"       → docs/legal/privacidad-2026-08-v3.md
 *     (texto servido entre 2026-08-11 y 2026-09-03 — DeepInfra único
 *     proveedor; copy de modelos atribuía Qwen a Google)
 *   - "terms-2026-08-v1"         → docs/legal/terminos-2026-08-v1.md
 *     (texto servido entre 2026-08-06 y 2026-09-03 — sin nombre de
 *     responsable; borrado solo por correo)
 *
 * When the legal text is updated, bump these constants AND keep the old
 * version's document in the repo (append-only) so every persisted Consent
 * row can be traced back to the exact text the user accepted.
 *
 * OJO: subir estas constantes NO re-pide el consentimiento a quien ya está
 * registrado — nada en el código compara la versión aceptada contra la
 * actual. Los términos §10 prometen pedir la aceptación de la versión nueva,
 * así que hoy eso se cumple a mano (avisarle a los usuarios existentes).
 */
export const CURRENT_TERMS_VERSION = "terms-2026-09-v2" as const;
export const CURRENT_PRIVACY_VERSION = "privacy-2026-09-v4" as const;

/**
 * Convenience tuple for the signup flow — both consents use the same
 * versioning scheme.
 */
export const CURRENT_POLICY_VERSIONS = {
  terms_13plus: CURRENT_TERMS_VERSION,
  privacy_policy: CURRENT_PRIVACY_VERSION,
} as const;
