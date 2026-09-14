/**
 * GET /PATCH /v1/me — perfil mínimo del estudiante autenticado.
 *
 * PATCH — A3a (localización es/en) + D-C07 (onboarding), en el MISMO
 * endpoint porque los dos son "el dispositivo sincroniza un pedazo de
 * estado de `users` contra el server", con el mismo contrato de body
 * parcial (al menos un campo):
 *
 *   PATCH /v1/me { "preferredLanguageCode": "es" | "en" }  → 204
 *   PATCH /v1/me { "onboardingCompleted": true }            → 204
 *   PATCH /v1/me { "preferredLanguageCode": "en", "onboardingCompleted": true } → 204 (ambos a la vez)
 *   401 sin bearer · 400 `invalid_request` con locale inválida, cuerpo
 *   malformado, o cuerpo sin NINGUNO de los dos campos.
 *
 * El contrato de A3a (tipado en el cliente desde A1 — `updatePreferredLanguage`)
 * NO se rompe: `preferredLanguageCode` sigue siendo el único campo que un
 * cliente viejo manda, sigue aceptando sólo "es"/"en", y sigue devolviendo
 * 204 sin cuerpo. `onboardingCompleted` es aditivo — un `z.literal(true)`
 * opcional, nunca `false` (no existe "des-completar" el onboarding).
 *
 * Idempotente por construcción en ambos sentidos: escribir el mismo locale
 * dos veces, o marcar `onboardingCompleted` dos veces, deja el mismo estado
 * observable (sólo `updatedAt`/`onboardingCompletedAt` avanzan — ver
 * docblock de `markOnboardingCompleted`, ningún lector depende del instante
 * exacto de sellado, sólo de "es no-null").
 *
 * GET — D-C07: el gate de onboarding del cliente (`lib/onboardGate.ts`,
 * C2-c) necesita saber si `users.onboardingCompletedAt` es NULL sin tener
 * que inflar `/v1/auth/verify`. Respuesta mínima a propósito — este
 * endpoint no es un espejo completo de `User` (ese rol lo cumple
 * `GET /v1/account/export`); crece campo a campo cuando algo más lo
 * necesite, no por completitud especulativa.
 *
 *   GET /v1/me → 200 { "onboardingCompletedAt": string | null }
 *   401 sin bearer.
 *
 * Sin migración nueva en A3a (columna B3 preexistente); D-C07 la agrega en
 * `0015_onboarding_seed_columns.sql` (`users.onboarding_completed_at`,
 * nullable — la guardia de privacidad la cubre por patrón automático
 * `/At$/`, "timestamp ISO-8601", sin declaración manual).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { findUserById, markOnboardingCompleted, setPreferredLanguage } from "../repositories/users";

const PatchMeSchema = z
  .object({
    preferredLanguageCode: z.enum(["es", "en"]).optional(),
    /** D-C07 — sólo `true`: sellar el onboarding. No existe "des-sellar". */
    onboardingCompleted: z.literal(true).optional(),
  })
  .refine((data) => data.preferredLanguageCode !== undefined || data.onboardingCompleted !== undefined, {
    message: "at least one of preferredLanguageCode or onboardingCompleted is required",
  });

export function createMeRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const user = await findUserById(deps.db, c.get("userId"));
    if (!user) return errorResponse(c, "not_found", "User not found");
    return c.json({ onboardingCompletedAt: user.onboardingCompletedAt });
  });

  app.patch("/", async (c) => {
    const parsed = PatchMeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const userId = c.get("userId");
    if (parsed.data.preferredLanguageCode !== undefined) {
      await setPreferredLanguage(deps.db, userId, parsed.data.preferredLanguageCode);
    }
    if (parsed.data.onboardingCompleted) {
      await markOnboardingCompleted(deps.db, userId);
    }
    return c.body(null, 204);
  });

  return app;
}
