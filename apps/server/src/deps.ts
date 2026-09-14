/**
 * The single dependency-injection bag threaded through `createApp` and
 * every route module. Prod boot (src/index.ts) builds one with real
 * implementations (Postgres, console email/safety-notify, the production
 * `ProviderResolver`); every test builds one with fakes/pglite — the SAME
 * `createApp` factory runs in both, so route wiring itself is under test,
 * not just the pieces behind it.
 */
import type { Db } from "./db/client";
import type { ServerEnv } from "./env";
import type { EmailSender } from "./auth/email";
import type { SafetyClassifier } from "./safety/classifier";
import type { SafetyNotifier } from "./safety/incident";
import type { ModelAdapters } from "./models/adapters";
import type { QuotaConfig } from "./quota/enforce";
import type { RasterizerService } from "./raster/rasterizer";
import type { MasteryAggregationRunConfig } from "./mastery/aggregate";

export interface AppDeps {
  db: Db;
  env: ServerEnv;
  emailSender: EmailSender;
  safetyClassifier: SafetyClassifier;
  safetyNotifier: SafetyNotifier;
  models: ModelAdapters;
  quotaConfig: QuotaConfig;
  /** F2 WQ1 — the rasterizer materials/pipeline.ts uses for Tier-2 pages. Real boot wires `NapiCanvasRasterizerService`; tests can inject a stub for timeout/error scenarios. */
  rasterizer: RasterizerService;
  judgeSampleRate: number;
  /** Diseño de dos modelos (2026-08-11): fracción de intercambios en los que el assessor de MASTERY (Qwen) corre además del de banda. */
  masteryAssessorSampleRate: number;
  /** B2-motor-de-dominio.md §5.1/§7.2 — visibility flag + tripleta allowlist, parsed once at boot (index.ts) from env.ts. */
  masteryAggregationConfig: MasteryAggregationRunConfig;
  sessionDeps: { secret: string; issuer: string; ttlSeconds: number };
  /** Injectable clock for deterministic tests (token expiry, quota period boundaries). */
  now: () => Date;
  /** Injectable RNG for deterministic judge-sampling tests (D3 §7) — defaults to Math.random in prod. */
  random: () => number;
}
