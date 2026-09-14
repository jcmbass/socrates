/**
 * Server env parsing — fail-loud at boot (same philosophy as
 * `@buxo/models`'s config load, C-backend-plataforma.md §1.2's "invariante
 * de arranque"): a malformed/missing required var throws immediately in
 * `readEnv`, never lazily the first time a route touches it.
 */
import { z } from "zod";
import type { Environment } from "@buxo/models/task";

/**
 * Render/dashboard values often arrive as `"1"`, `True`, `yes`, or with
 * trailing space. The previous exact match (`"true"` / `"1"`) left the
 * guided-items chain empty and every session degraded without a boot error.
 */
export function parseEnvFlag(value: string | undefined): boolean {
  if (value == null) return false;
  const normalized = value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** Documented dev default. Staging/prod must set a distinct random value. */
const DEFAULT_JWT_SECRET = "dev-only-insecure-secret-change-me-32-chars-min";

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Maps to @buxo/models' Environment ("dev" | "staging" | "prod") — see toModelsEnvironment below. */
    BUXO_ENV: z.enum(["dev", "staging", "prod"]).default("dev"),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1).default("postgres://buxo:buxo@localhost:5432/buxo"),

    JWT_SECRET: z.string().min(16).default(DEFAULT_JWT_SECRET),
    JWT_ISSUER: z.string().min(1).default("buxo-server"),
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

    MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(20),
    MAGIC_LINK_BASE_URL: z.string().min(1).default("http://localhost:3001/v1/auth/verify"),

    /**
     * BE3 (2026-08-02): email transport for magic links.
     * `console` (default) — logs the link (dev / pre-Resend Render).
     * `resend` — real inbox via Resend REST; requires `RESEND_API_KEY`
     * (fail-loud below if missing).
     */
    EMAIL_SENDER: z.enum(["console", "resend"]).default("console"),
    RESEND_API_KEY: z.string().optional(),
    /**
     * Remitente Resend. Default = free-tier onboarding address (works before
     * domain verify). Objetivo institucional tras verificar `cubo.lat`:
     * `Socrates <no-reply@socrates.cubo.lat>`.
     */
    EMAIL_FROM: z.string().min(1).default("Socrates <onboarding@resend.dev>"),

    QUOTA_DAILY_TUTOR_MESSAGES: z.coerce.number().int().positive().default(25),
    QUOTA_MONTHLY_TUTOR_MESSAGES: z.coerce.number().int().positive().default(175),
    QUOTA_CAP_COST_USD: z.coerce.number().positive().default(4),
    /**
     * F2 WQ1 — flagged for architect review, same as the raster limits
     * (`raster/limits.ts`): first-pass estimates. A daily ceiling of 20
     * cloud-tier pages absorbs a handful of real study-guide uploads
     * (`docs/guia1.pdf`-sized) per day without materially widening the D3
     * cost envelope the tutor quota already assumes; monthly follows the
     * same ~7-8x multiple `QUOTA_MONTHLY_TUTOR_MESSAGES`/
     * `QUOTA_DAILY_TUTOR_MESSAGES` already uses (175/25 = 7).
     */
    QUOTA_DAILY_INGEST_CLOUD_PAGES: z.coerce.number().int().positive().default(20),
    QUOTA_MONTHLY_INGEST_CLOUD_PAGES: z.coerce.number().int().positive().default(150),
    JUDGE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.2),
    /**
     * Diseño de dos modelos (2026-08-11): fracción (0-1) de intercambios en
     * los que el assessor de MASTERY (Qwen, lento y preciso) corre además del
     * de banda (DeepSeek, rápido). Default 1/3 — la racha avanza a esta
     * velocidad (ver guía de flip: cambio de comportamiento que el founder
     * calibra con uso real).
     */
    MASTERY_ASSESSOR_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1 / 3),

    BUXO_TUTOR_CHAIN: z.string().optional(),
    BUXO_ASSESSOR_CHAIN: z.string().optional(),
    BUXO_JUDGE_CHAIN: z.string().optional(),
    BUXO_INGEST_CHAIN: z.string().optional(),
    BUXO_SAFETY_CHAIN: z.string().optional(),
    /** P2 — cadena para el temario-builder agéntico (default: piso Sonnet). */
    BUXO_TEMARIO_BUILDER_CHAIN: z.string().optional(),
    /** Diseño de dos modelos (2026-08-11): cadena del assessor de MASTERY (Qwen, muestreado). Sin piso Anthropic. */
    BUXO_MASTERY_ASSESSOR_CHAIN: z.string().optional(),
    /** Structured generator for guided-session content; defaults to its DeepInfra floor. */
    BUXO_GUIDED_ITEMS_CHAIN: z.string().optional(),
    /**
     * Fail-close switch for production rollout. When enabled, a topic with
     * no Fuentes returns the explicit degraded session without calling a
     * model. Closed beta defaults to general-knowledge generation.
     */
    BUXO_GUIDED_REQUIRE_SOURCES: z
      .string()
      .optional()
      .transform((v) => parseEnvFlag(v)),
    /**
     * Narrow closed-beta opt-in: serve the pending_gate `guided-items` chain
     * (DeepSeek-V4-Flash-0731 has no O-14 for this task). Unlike BUXO_DEV_ALLOW_PENDING_GATE,
     * this MAY be true in staging/prod and does not ungate any other task.
     * Default false → empty chain, generation degrades.
     */
    BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: z
      .string()
      .optional()
      .transform((v) => parseEnvFlag(v)),
    BUXO_DEV_ALLOW_PENDING_GATE: z
      .string()
      .optional()
      .transform((v) => parseEnvFlag(v)),

    /**
     * Beta externa (BE2 decision, 2026-07-18): controla si el piso Sonnet se
     * appendea a la cadena del tutor como failover. "sonnet" (default) preserva
     * el comportamiento actual. "none" elimina el piso del tutor: si el modelo
     * configurado falla, la petición falla RUIDOSO (ModelChainExhaustedError)
     * en vez de caer silenciosamente a Anthropic. Esto protege la directiva del
     * founder: Anthropic solo gasta por la vía del assessor, capeada por cuota.
     * Solo afecta al tutor. Assessor/judge/ingest/safety inalterados.
     */
    BUXO_TUTOR_FAILOVER_FLOOR: z.enum(["sonnet", "none"]).default("sonnet"),

    /**
     * Beta externa (BE2 decision, 2026-07-18): selecciona la versión del prompt
     * del tutor. "buxo-socratic-v3" (default) es el prompt base gateado.
     * "buxo-socratic-v4" activa las reglas endurecidas (hardened) que pasaron
     * el gate O-14 del tutor en BE2 (3/3 suites, resistencia a "dame la
     * respuesta" en ambos intentos). El Flip beta DEBE servir v4, NO v3.
     */
    BUXO_TUTOR_PROMPT_VERSION: z.enum(["buxo-socratic-v3", "buxo-socratic-v4"]).default("buxo-socratic-v3"),

    /**
     * Opt-in dev mode (F1/WP6 Part 1): swaps the real `ProviderResolver`
     * (models/provider.ts, real @ai-sdk/anthropic + real "ai"
     * streamText/generateObject) for models/fake-adapters.ts's fully-fake
     * ModelAdapters — canned Socratic tutor replies + deterministic
     * assessor/judge verdicts, ZERO network calls. Guarded below
     * (superRefine): enabling this outside BUXO_ENV=dev is a config error
     * and throws at `readEnv` time — fail-loud, same invariant as
     * `devAllowPendingGate`, this must never leak into staging/prod.
     */
    BUXO_FAKE_MODELS: z
      .string()
      .optional()
      .transform((v) => parseEnvFlag(v)),

    ANTHROPIC_API_KEY: z.string().optional(),
    /**
     * PB2: se normaliza en provider.ts para que `https://api.anthropic.com`
     * (sin `/v1`) funcione — el SDK construye `${baseURL}/messages` y sin
     * `/v1` da 404 silencioso.
     */
    ANTHROPIC_BASE_URL: z.string().optional(),
    OLLAMA_BASE_URL: z.string().default("http://localhost:11434/v1"),
    /**
     * Requerida para cloud directo (Ollama cloud); innecesaria para daemon
     * local (http://localhost:11434/v1). El founder la pega en Render como
     * OLLAMA_API_KEY.
     */
    OLLAMA_API_KEY: z.string().optional(),

    /**
     * DeepInfra — provider OpenAI-compat para `Qwen/Qwen3-VL-30B-A3B-Instruct`,
     * candidato Tier-2 de ingesta (transcripción imagen→texto) medido
     * 2026-08-01: ~6x más barato que Haiku y mejor calidad medida (ver
     * docs/plan-modal-rag/05-medicion-deepinfra-por-token.md). `pending_gate`
     * en el registry (packages/models/registry.ts) — NO sirve tráfico fuera de
     * dev+BUXO_DEV_ALLOW_PENDING_GATE hasta correr el gate O-14 formal. Mismo
     * patrón que OLLAMA_API_KEY/OLLAMA_BASE_URL.
     */
    DEEPINFRA_API_KEY: z.string().optional(),
    DEEPINFRA_BASE_URL: z.string().default("https://api.deepinfra.com/v1/openai"),

    /**
     * B2-motor-de-dominio.md §5.1 — single server-side source of truth for
     * whether `MasteryState` is shown to the student ("visible") or only
     * computed silently ("shadow"). Default `"shadow"`: O-5 requires shadow
     * mode for the whole beta; flipping this is a manual, gated decision
     * (§5.3), never automatic.
     */
    MASTERY_VISIBILITY_MODE: z.enum(["shadow", "visible"]).default("shadow"),
    /**
     * P1 — XP aggregation policy when an assessment demotes a student's tier
     * (negative delta). "subtract" (default) reduces the visible total;
     * "floor" clamps the total to zero; "grow_only" discards negative deltas.
     * This lets the founder change the policy without touching code.
     * TODO: final curve and policy are open questions (plan-producto 00 §7 Q1).
     */
    BUXO_XP_DEMOTION_POLICY: z.enum(["subtract", "floor", "grow_only"]).default("subtract"),
    /**
     * B2 §7.2 — JSON array of "providerId/modelId/promptVersion" strings
     * (each field may be "*" as a wildcard) naming assessor tripletas
     * approved to feed mastery aggregation. Parsed/validated by
     * `mastery/aggregate.ts`'s `parseAssessorAggregationAllowlist`, not
     * here (domain-specific format, kept next to its only consumer).
     * UNSET/VACIO -> deny-all (PB2: flip de allow-all a deny-by-default).
     * En **dev** la agregación se detiene hasta que el founder setee
     * esta variable (p.ej. un entry comodin "proveedor/modelo/version" para allow-all).
     */
    BUXO_ASSESSOR_AGGREGATION_ALLOWLIST: z.string().optional(),
    /**
     * Plan-xp-progreso Fase 4 — minutes of inactivity after which an active
     * study session is marked `abandoned`. No magic number in code: unset
     * defaults to 60. Reactivation opens a NEW session that references the
     * closed one via `previous_session_id`.
     */
    SESSION_INACTIVITY_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(60),

    /**
     * Enrolamiento de testers para la prueba cerrada de Play Console
     * (2026-09-05): un único link público (`/entrar?token=<este valor>`) que
     * cualquier cantidad de personas puede abrir sin credenciales reales —
     * la plataforma de testers no permite mensajear individualmente, así que
     * no hay forma de repartir un enlace por persona. Cada apertura crea una
     * cuenta NUEVA (nunca una compartida): preserva el valor de la prueba
     * cerrada (datos de uso por persona distinta). Camino 100% separado de
     * `magic_link_tokens`/`verifyMagicLink` — cero riesgo para el login real.
     * UNSET (default) = la ruta está completamente desactivada. Las dos
     * variables se exigen juntas (ver superRefine): un token sin vencimiento
     * sería un backdoor permanente, justo lo que esto no debe ser.
     */
    TESTER_ENROLL_TOKEN: z.string().min(16).optional(),
    TESTER_ENROLL_EXPIRES_AT: z.string().datetime().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.BUXO_FAKE_MODELS && env.BUXO_ENV !== "dev") {
      ctx.addIssue({
        code: "custom",
        message:
          `BUXO_FAKE_MODELS=1 solo es válido cuando BUXO_ENV=dev (recibido "${env.BUXO_ENV}") — ` +
          `el modo de modelos fake nunca debe llegar a staging/prod.`,
        path: ["BUXO_FAKE_MODELS"],
      });
    }
    if ((env.BUXO_ENV === "staging" || env.BUXO_ENV === "prod") && env.JWT_SECRET === DEFAULT_JWT_SECRET) {
      ctx.addIssue({
        code: "custom",
        message:
          `JWT_SECRET debe ser un valor aleatorio cuando BUXO_ENV=${env.BUXO_ENV} — ` +
          `el default de desarrollo no es válido en staging/prod.`,
        path: ["JWT_SECRET"],
      });
    }
    if ((env.TESTER_ENROLL_TOKEN && !env.TESTER_ENROLL_EXPIRES_AT) || (env.TESTER_ENROLL_EXPIRES_AT && !env.TESTER_ENROLL_TOKEN)) {
      ctx.addIssue({
        code: "custom",
        message:
          "TESTER_ENROLL_TOKEN y TESTER_ENROLL_EXPIRES_AT deben setearse juntas o ninguna — " +
          "un token de enrolamiento sin vencimiento sería un backdoor permanente.",
        path: ["TESTER_ENROLL_TOKEN"],
      });
    }
    if (env.EMAIL_SENDER === "resend" && !env.RESEND_API_KEY?.trim()) {
      ctx.addIssue({
        code: "custom",
        message:
          `EMAIL_SENDER=resend requiere RESEND_API_KEY (ausente o vacío) — ` +
          `sin clave no se puede enviar el magic link a estudiantes.`,
        path: ["RESEND_API_KEY"],
      });
    }
  });

export type ServerEnv = z.infer<typeof EnvSchema>;

export function guidedItemsHealth(env: Pick<
  ServerEnv,
  "BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE" | "BUXO_GUIDED_REQUIRE_SOURCES" | "BUXO_GUIDED_ITEMS_CHAIN"
>) {
  const chainConfigured = Boolean(env.BUXO_GUIDED_ITEMS_CHAIN?.trim());
  return {
    ready: env.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE && chainConfigured && !env.BUXO_GUIDED_REQUIRE_SOURCES,
    allowPendingGate: env.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE,
    requireSources: env.BUXO_GUIDED_REQUIRE_SOURCES,
    chainConfigured,
  };
}

/** Throws (via zod) on any malformed value — called exactly once, at boot. */
export function readEnv(raw: NodeJS.ProcessEnv): ServerEnv {
  return EnvSchema.parse(raw);
}

export function toModelsEnvironment(env: ServerEnv): Environment {
  return env.BUXO_ENV;
}
