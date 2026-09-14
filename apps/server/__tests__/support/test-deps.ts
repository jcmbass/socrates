import { loadModelsConfig } from "@buxo/models/config";
import { DEFAULT_MASTERY_AGGREGATION_CONFIG } from "@buxo/domain/mastery-engine";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import type { AppDeps } from "../../src/deps";
import type { ServerEnv } from "../../src/env";
import { RecordingEmailSender } from "../../src/auth/email";
import { RuleBasedSafetyClassifier } from "../../src/safety/classifier";
import { RecordingSafetyNotifier } from "../../src/safety/incident";
import { createModelAdapters } from "../../src/models/adapters";
import { createFakeModelAdapters } from "../../src/models/fake-adapters";
import { fakeProviderResolver } from "./fake-provider";
import { NapiCanvasRasterizerService } from "../../src/raster/rasterizer";
import { parseAssessorAggregationAllowlist, type MasteryAggregationRunConfig } from "../../src/mastery/aggregate";

const TEST_ENV: ServerEnv = {
  NODE_ENV: "test",
  BUXO_ENV: "dev",
  PORT: 0,
  DATABASE_URL: "unused-in-tests",
  JWT_SECRET: "test-only-secret-at-least-32-characters-long",
  JWT_ISSUER: "buxo-server-test",
  SESSION_TTL_SECONDS: 60 * 60,
  MAGIC_LINK_TTL_MINUTES: 20,
  MAGIC_LINK_BASE_URL: "http://localhost:3001/v1/auth/verify",
  EMAIL_SENDER: "console",
  EMAIL_FROM: "Socrates <onboarding@resend.dev>",
  QUOTA_DAILY_TUTOR_MESSAGES: 3,
  QUOTA_MONTHLY_TUTOR_MESSAGES: 20,
  QUOTA_CAP_COST_USD: 1,
  QUOTA_DAILY_INGEST_CLOUD_PAGES: 5,
  QUOTA_MONTHLY_INGEST_CLOUD_PAGES: 20,
  JUDGE_SAMPLE_RATE: 0,
  MASTERY_ASSESSOR_SAMPLE_RATE: 1,
  BUXO_MASTERY_ASSESSOR_CHAIN: "deepinfra:Qwen/Qwen3.6-35B-A3B",
  /**
   * El assessor de BANDA tampoco recibe piso desde 2026-08-11 (misma razón que
   * `mastery-assessor`: ningún fallo puede caer a Anthropic en silencio, ver
   * `@buxo/models/config.ts` `skipFloor`), así que necesita cadena explícita o
   * `resolveChain(config, "assessor")` da `[]` y no corre el assessor. Sonnet
   * es una fila registrada y `validated`: reproduce el default derivado del
   * piso que este valor reemplaza, y mantiene los tests existentes en su
   * comportamiento previo.
   */
  BUXO_ASSESSOR_CHAIN: "anthropic:claude-sonnet-5",
  BUXO_DEV_ALLOW_PENDING_GATE: false,
  BUXO_TUTOR_FAILOVER_FLOOR: "sonnet",
  BUXO_TUTOR_PROMPT_VERSION: "buxo-socratic-v3",
  BUXO_FAKE_MODELS: false,
  // P2 FIX1 (2026-07-21): temario-builder no longer gets a Sonnet floor
  // appended automatically (see @buxo/models/config.ts's `skipFloor`), so
  // tests need an EXPLICIT single-model chain or `resolveChain(config,
  // "temario-builder")` resolves to `[]`. Sonnet is a registered,
  // toolUse-capable, gate-"validated" row — matches the prior floor-derived
  // default this replaces.
  BUXO_TEMARIO_BUILDER_CHAIN: "anthropic:claude-sonnet-5",
  BUXO_GUIDED_ITEMS_CHAIN: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731",
  BUXO_GUIDED_REQUIRE_SOURCES: false,
  BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: true,
  OLLAMA_BASE_URL: "http://localhost:11434/v1",
  DEEPINFRA_BASE_URL: "https://api.deepinfra.com/v1/openai",
  MASTERY_VISIBILITY_MODE: "shadow",
  BUXO_XP_DEMOTION_POLICY: "subtract",
  /** PB2: allow-all en tests por defecto (cada test que quiera deny-by-default lo sobreescribe). */
  BUXO_ASSESSOR_AGGREGATION_ALLOWLIST: '["*/*/*"]',
  SESSION_INACTIVITY_TIMEOUT_MINUTES: 60,
};

export interface BuildTestDepsOptions {
  envOverrides?: Partial<ServerEnv>;
  now?: () => Date;
  random?: () => number;
  rasterizer?: AppDeps["rasterizer"];
  /** Override the aggregation config wholesale (e.g. a lower topicMaterializationThreshold for a faster test) — takes precedence over envOverrides.MASTERY_VISIBILITY_MODE/BUXO_ASSESSOR_AGGREGATION_ALLOWLIST when given. */
  masteryAggregationConfig?: Partial<MasteryAggregationRunConfig>;
}

export interface TestContext {
  deps: AppDeps;
  testDb: TestDb;
}

export async function buildTestDeps(options: BuildTestDepsOptions = {}): Promise<TestContext> {
  const testDb = await createTestDb();
  const env = { ...TEST_ENV, ...options.envOverrides };
  const modelsConfig = loadModelsConfig({
    // P2 FIX1: temario-builder needs an explicit chain now (see the
    // BUXO_TEMARIO_BUILDER_CHAIN comment above) — every other task still
    // resolves off the empty raw config into its always-appended floor.
    // mastery-assessor (diseño de dos modelos, 2026-08-11) también necesita
    // su cadena explícita: NO tiene piso (skipFloor), así que sin ella la
    // cadena queda vacía y la llamada falla.
    raw: {
      temarioBuilder: env.BUXO_TEMARIO_BUILDER_CHAIN,
      masteryAssessor: env.BUXO_MASTERY_ASSESSOR_CHAIN,
      // assessor (banda) — sin piso desde 2026-08-11, igual que los dos de
      // arriba. Sin esta línea la cadena resuelve vacía, el assessor no corre
      // y los tests de turno completo fallan con `chain[0]` undefined.
      assessor: env.BUXO_ASSESSOR_CHAIN,
      guidedItems: env.BUXO_GUIDED_ITEMS_CHAIN,
    },
    environment: env.BUXO_ENV,
    devAllowPendingGate: env.BUXO_DEV_ALLOW_PENDING_GATE,
    tutorFailoverFloor: env.BUXO_TUTOR_FAILOVER_FLOOR,
    guidedItemsAllowPendingGate: env.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE,
  });
  const models = env.BUXO_FAKE_MODELS
    ? createFakeModelAdapters(modelsConfig, env.BUXO_ENV)
    : createModelAdapters({
        config: modelsConfig,
        resolveProvider: fakeProviderResolver,
        environment: env.BUXO_ENV,
        tutorPromptVersion: env.BUXO_TUTOR_PROMPT_VERSION,
      });

  const deps: AppDeps = {
    db: testDb.db,
    env,
    emailSender: new RecordingEmailSender(),
    safetyClassifier: new RuleBasedSafetyClassifier(),
    safetyNotifier: new RecordingSafetyNotifier(),
    models,
    quotaConfig: {
      dailyTutorMessages: env.QUOTA_DAILY_TUTOR_MESSAGES,
      monthlyTutorMessages: env.QUOTA_MONTHLY_TUTOR_MESSAGES,
      capCostUsd: env.QUOTA_CAP_COST_USD,
      dailyIngestCloudPages: env.QUOTA_DAILY_INGEST_CLOUD_PAGES,
      monthlyIngestCloudPages: env.QUOTA_MONTHLY_INGEST_CLOUD_PAGES,
    },
    rasterizer: options.rasterizer ?? new NapiCanvasRasterizerService(),
    judgeSampleRate: env.JUDGE_SAMPLE_RATE,
    masteryAssessorSampleRate: env.MASTERY_ASSESSOR_SAMPLE_RATE,
    masteryAggregationConfig: {
      aggregation: DEFAULT_MASTERY_AGGREGATION_CONFIG,
      visibilityMode: env.MASTERY_VISIBILITY_MODE,
      allowlist: parseAssessorAggregationAllowlist(env.BUXO_ASSESSOR_AGGREGATION_ALLOWLIST),
      ...options.masteryAggregationConfig,
    },
    sessionDeps: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER, ttlSeconds: env.SESSION_TTL_SECONDS },
    now: options.now ?? (() => new Date()),
    random: options.random ?? (() => Math.random()),
  };

  return { deps, testDb };
}
