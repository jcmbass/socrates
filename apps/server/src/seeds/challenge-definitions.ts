/**
 * Seeds de challenges iniciales — B2 §4.1. Set chico conservador:
 * - consolidated: ≥2 sesiones, ≥2 días (por materia)
 * - mastered: ≥2 sesiones, ≥3 días (por materia)
 *
 * Versionado como `b2-gam-1` (B2_GAMIFICATION_VERSION). Un retune de
 * umbrales es un cambio de versión, no un ajuste silencioso (B2 §2).
 * Estos seeds se ejecutan en la migración 0004 o como script one-off.
 *
 * Racional:
 * - "consolidated" requiere 2 sesiones en 2 días distintos — evita que
 *   un solo día de estudio intensivo otorgue el logro (anti-farmeo O-7).
 * - "mastered" requiere 3 días distintos — consistente con la definición
 *   de "sostenido en el tiempo" (B2 §4.1 table).
 * - No se incluye "developing" como challenge porque el tier developing
 *   se alcanza con 3 assessments positivos consecutivos en una misma
 *   sesión — el umbral es demasiado bajo para un logro significativo.
 * - No se incluyen challenges por topic (scope topic) en esta versión
 *   inicial — se agregarán cuando haya datos de uso que justifiquen
 *   los umbrales (B2 §10 P-5).
 */
import type { Db } from "../db/client";
import { challengeDefinitions } from "../db/schema";
import type { ChallengeScope } from "@buxo/domain/gamification";
import { nowIso } from "../repositories/ids";

export interface SeedChallengeDefinition {
  subjectId: string;
}

const GAMIFICATION_VERSION = "b2-gam-1";

export const SEED_CHALLENGES = [
  {
    titleKey: "challenge.consolidated.subject.title",
    descriptionKey: "challenge.consolidated.subject.description",
    version: GAMIFICATION_VERSION,
    criteria: {
      requiredTier: "consolidated",
      minDistinctSessions: 2,
      minDistinctCalendarDays: 2,
    },
  },
  {
    titleKey: "challenge.mastered.subject.title",
    descriptionKey: "challenge.mastered.subject.description",
    version: GAMIFICATION_VERSION,
    criteria: {
      requiredTier: "mastered",
      minDistinctSessions: 2,
      minDistinctCalendarDays: 3,
    },
  },
] as const;

function scopeSeed(scope: ChallengeScope): string {
  if (scope.kind === "subject") return `subject:${scope.subjectId}`;
  if (scope.kind === "topic") return `topic:${scope.subjectId}:${scope.topicKey}`;
  return "generic";
}

async function deterministicId(seed: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(seed);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Seeds the challenge_definitions table with the initial set of challenges.
 * Idempotent: the id is derived deterministically from (scope, titleKey,
 * version), so repeated calls with the same inputs skip already-existing
 * rows via onConflictDoNothing.
 *
 * CUIDADO con lo que esto NO hace: `criteria` **no entra** en el hash del id.
 * Solo `(scope, titleKey, version)`. O sea que **editar `criteria` sin subir
 * `version` es un no-op silencioso** — `onConflictDoNothing` salta la fila y
 * la definición vieja sigue vigente, sin error ni aviso.
 *
 * Eso es coherente con la convención que ya declara `db/schema.ts`
 * ("Versionado: a criteria change produces a NEW row with a new version,
 * never mutates an existing one"), pero solo si quien toca `criteria`
 * **se acuerda de subir `version`**. No hay nada que lo obligue.
 */
export async function seedChallengeDefinitions(db: Db, subjectId: string): Promise<void> {
  const now = nowIso();

  for (const seed of SEED_CHALLENGES) {
    const scope: ChallengeScope = { kind: "subject", subjectId };
    const idSeed = `${scopeSeed(scope)}:${seed.titleKey}:${seed.version}`;
    await db
      .insert(challengeDefinitions)
      .values({
        id: await deterministicId(idSeed),
        scope,
        titleKey: seed.titleKey,
        descriptionKey: seed.descriptionKey,
        version: seed.version,
        criteria: seed.criteria,
        active: true,
        createdAt: now,
        schemaVersion: 1,
      })
      .onConflictDoNothing({
        target: [challengeDefinitions.id],
      });
  }
}
