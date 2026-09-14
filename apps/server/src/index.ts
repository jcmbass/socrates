/**
 * Real boot entrypoint (`npm start` / `node dist/index.js`). Run
 * `npm run db:migrate -w apps/server` against `DATABASE_URL` before
 * starting — this file does not auto-migrate (avoids races between
 * multiple instances migrating concurrently on deploy).
 *
 * FAIL-LOUD INVARIANT (C-backend §1.2, C7's central rule): `loadModelsConfig`
 * is called here, at the top level, UNWRAPPED by any try/catch. A
 * malformed/unregistered chain entry in `BUXO_TUTOR_CHAIN` etc. must crash
 * the process before it ever binds a port — never degrade, never serve a
 * single request on a bad config. Do not wrap this call.
 */
import { serve } from "@hono/node-server";
import { loadModelsConfig } from "@buxo/models/config";
import { createApp } from "./app";
import { readEnv, toModelsEnvironment } from "./env";
import { createPgDb } from "./db/client";
import { buildModelAdapters, logFakeModelsBanner } from "./models/select";
import { assertGuidedItemsChainReady, modelsRawConfigFromEnv } from "./models/config-from-env";
import { createEmailSender } from "./auth/email";
import { RuleBasedSafetyClassifier } from "./safety/classifier";
import { ConsoleSafetyNotifier } from "./safety/incident";
import { NapiCanvasRasterizerService } from "./raster/rasterizer";
import { parseAssessorAggregationAllowlist, runMasteryDecaySweep } from "./mastery/aggregate";
import { DEFAULT_MASTERY_AGGREGATION_CONFIG } from "@buxo/domain/mastery-engine";
import { abandonInactiveStudySessions } from "./repositories/study-sessions";
import type { AppDeps } from "./deps";

// Fail-loud: throws (via src/env.ts's `superRefine`) if BUXO_FAKE_MODELS=1
// is set outside BUXO_ENV=dev — the fake-models mode must never leak into
// staging/prod. Also fails if EMAIL_SENDER=resend without RESEND_API_KEY.
// Never wrap this call either, same invariant as the `loadModelsConfig`
// call below.
const env = readEnv(process.env);
if (env.BUXO_FAKE_MODELS) logFakeModelsBanner();

// Fail-loud: see module doc above. Never wrap this in try/catch.
const modelsConfig = loadModelsConfig({
  raw: modelsRawConfigFromEnv(env),
  environment: toModelsEnvironment(env),
  devAllowPendingGate: env.BUXO_DEV_ALLOW_PENDING_GATE,
  tutorFailoverFloor: env.BUXO_TUTOR_FAILOVER_FLOOR,
  guidedItemsAllowPendingGate: env.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE,
});
assertGuidedItemsChainReady(env, modelsConfig);
console.log(
  `[buxo-server] guided-items models=${modelsConfig.chains["guided-items"].length} ` +
    `allowPendingGate=${env.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE} ` +
    `requireSources=${env.BUXO_GUIDED_REQUIRE_SOURCES}`,
);

const { db } = createPgDb(env.DATABASE_URL);
const models = buildModelAdapters(env, modelsConfig);

// Fail-loud: see module doc above — a malformed BUXO_ASSESSOR_AGGREGATION_ALLOWLIST must crash boot, never silently fall back to allow-all or deny-all.
const masteryAggregationConfig = {
  aggregation: DEFAULT_MASTERY_AGGREGATION_CONFIG,
  visibilityMode: env.MASTERY_VISIBILITY_MODE,
  allowlist: parseAssessorAggregationAllowlist(env.BUXO_ASSESSOR_AGGREGATION_ALLOWLIST),
};

const deps: AppDeps = {
  db,
  env,
  emailSender: createEmailSender(env),
  safetyClassifier: new RuleBasedSafetyClassifier(),
  safetyNotifier: new ConsoleSafetyNotifier(),
  models,
  quotaConfig: {
    dailyTutorMessages: env.QUOTA_DAILY_TUTOR_MESSAGES,
    monthlyTutorMessages: env.QUOTA_MONTHLY_TUTOR_MESSAGES,
    capCostUsd: env.QUOTA_CAP_COST_USD,
    dailyIngestCloudPages: env.QUOTA_DAILY_INGEST_CLOUD_PAGES,
    monthlyIngestCloudPages: env.QUOTA_MONTHLY_INGEST_CLOUD_PAGES,
  },
  rasterizer: new NapiCanvasRasterizerService(),
  judgeSampleRate: env.JUDGE_SAMPLE_RATE,
  masteryAssessorSampleRate: env.MASTERY_ASSESSOR_SAMPLE_RATE,
  masteryAggregationConfig,
  sessionDeps: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER, ttlSeconds: env.SESSION_TTL_SECONDS },
  now: () => new Date(),
  random: () => Math.random(),
};

const app = createApp(deps);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[buxo-server] listening on :${info.port} (env=${env.BUXO_ENV})`);
});

// B2-motor-de-dominio.md §1.5/§9.4 — periodic decay sweep. Runs once at
// boot (never blocks binding the port — fire-and-forget), then every 24h.
// `.unref()` so a pending sweep never keeps the process alive past a normal
// shutdown signal.
function sweepDecayOnce(): void {
  runMasteryDecaySweep(db, new Date(), masteryAggregationConfig).catch((err: unknown) => {
    console.error("[mastery] decay sweep failed:", err);
  });
}
sweepDecayOnce();
setInterval(sweepDecayOnce, 24 * 60 * 60 * 1000).unref();

// Plan-xp-progreso Fase 4 — close inactive study sessions. Threshold from
// SESSION_INACTIVITY_TIMEOUT_MINUTES (no magic number). Runs every 15 min.
function sweepInactiveSessionsOnce(): void {
  const cutoff = new Date(Date.now() - env.SESSION_INACTIVITY_TIMEOUT_MINUTES * 60 * 1000).toISOString();
  abandonInactiveStudySessions(db, cutoff)
    .then((n) => {
      if (n > 0) console.log(`[sessions] abandoned ${n} inactive session(s) (cutoff=${cutoff})`);
    })
    .catch((err: unknown) => {
      console.error("[sessions] inactivity sweep failed:", err);
    });
}
sweepInactiveSessionsOnce();
setInterval(sweepInactiveSessionsOnce, 15 * 60 * 1000).unref();
