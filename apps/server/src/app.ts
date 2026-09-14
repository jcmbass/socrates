/**
 * App factory — the SAME function prod boot (src/index.ts) and every test
 * call to build the Hono app, so route wiring (auth middleware placement,
 * mount points) is itself under test, not just what's behind each route.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppDeps } from "./deps";
import type { AuthVariables } from "./auth/middleware";
import { requireAuth } from "./auth/middleware";
import { errorResponse } from "./errors";
import { guidedItemsHealth } from "./env";
import { createAuthRoutes } from "./routes/auth";
import { createCoursesRoutes } from "./routes/courses";
import { createSubjectsRoutes } from "./routes/subjects";
import { createMaterialsRoutes } from "./routes/materials";
import { createSessionsRoutes } from "./routes/sessions";
import { createMasteryRoutes } from "./routes/mastery";
import { createAchievementsRoutes } from "./routes/achievements";
import { createStreakRoutes } from "./routes/streak";
import { createActivityRoutes } from "./routes/activity";
import { createAccountRoutes } from "./routes/account";
import { createMeRoutes } from "./routes/me";
import { createTemarioRoutes } from "./routes/temarios";
import { createFuentesRoutes } from "./routes/fuentes";
import { createXpRoutes } from "./routes/xp";
import { createEntrarRoutes } from "./routes/entrar";
import { createLegalRoutes } from "./routes/legal";
import { createSeedRoutes } from "./routes/seed";
import { createGuidedRoutes } from "./routes/guided";

export function createApp(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  /**
   * CORS **solo en dev**, para el harness `harness/web-local/`: Metro web
   * sirve la app en `:8081` y el server vive en `:3001`, o sea que cada
   * llamada del navegador es cross-origin. Sin esto el preflight `OPTIONS`
   * cae en el 404 de abajo y el navegador bloquea TODA petición — la app
   * muestra "No pudimos conectar con el servidor" aunque el server esté
   * perfectamente vivo (verificable con `curl`, que no aplica CORS).
   *
   * Por qué no se había notado: `harness/web-local/shot.mjs` lanza Chromium
   * con `--disable-web-security`, así que el camino de capturas automáticas
   * nunca ejerció CORS. Un navegador normal sí, y ahí aparece el fallo.
   *
   * Acotado a `BUXO_ENV=dev` y a orígenes de loopback: en staging/prod el
   * middleware no se monta, así que la superficie de producción no cambia.
   * El cliente móvil (nativo) no manda `Origin` y nunca dependió de esto.
   */
  if (deps.env.BUXO_ENV === "dev") {
    app.use(
      "/*",
      cors({
        origin: (origin) => (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : null),
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
        credentials: false,
      }),
    );
  }

  app.get("/healthz", (c) => c.json({ ok: true, guidedItems: guidedItemsHealth(deps.env) }));

  // Public HTTPS trampoline → buxo://login (WhatsApp-touchable magic links).
  // Outside /v1/* — human-facing URL; does not validate or consume the token.
  app.route("/entrar", createEntrarRoutes());

  // Públicas y SIN auth a propósito: son los documentos que el estudiante
  // abre desde la casilla "Acepto los términos", antes de tener cuenta.
  app.route("/legal", createLegalRoutes());

  // Públicas y SIN auth a propósito (C2-a, ver docblock de routes/seed.ts):
  // catálogo de temarios seed, no depende de ningún userId.
  app.route("/v1/seed", createSeedRoutes(deps));

  // Public — no bearer auth (issuing/consuming the auth itself).
  app.route("/v1/auth", createAuthRoutes(deps));

  // Everything else behind bearer auth (C-backend §2.4: "token bearer por sesión").
  const auth = requireAuth(deps);
  app.use("/v1/courses/*", auth);
  app.use("/v1/subjects/*", auth);
  app.use("/v1/materials/*", auth);
  app.use("/v1/sessions/*", auth);
  app.use("/v1/mastery/*", auth);
  app.use("/v1/achievements/*", auth);
  app.use("/v1/account/*", auth);
  app.use("/v1/me/*", auth);
  app.use("/v1/streak/*", auth);
  app.use("/v1/activity/*", auth);
  app.use("/v1/temario/*", auth);
  app.use("/v1/fuentes/*", auth);
  app.use("/v1/xp/*", auth);
  // Also cover the bare collection paths (no trailing segment) — Hono's
  // `/*` middleware only matches when there IS a further path segment.
  app.use("/v1/courses", auth);
  app.use("/v1/subjects", auth);
  app.use("/v1/materials", auth);
  app.use("/v1/sessions", auth);
  app.use("/v1/account", auth);
  app.use("/v1/me", auth);
  app.use("/v1/streak", auth);
  app.use("/v1/activity", auth);
  app.use("/v1/temario", auth);
  app.use("/v1/fuentes", auth);
  app.use("/v1/xp", auth);

  app.route("/v1/courses", createCoursesRoutes(deps));
  app.route("/v1/subjects", createSubjectsRoutes(deps));
  app.route("/v1/subjects", createGuidedRoutes(deps));
  app.route("/v1/materials", createMaterialsRoutes(deps));
  app.route("/v1/sessions", createSessionsRoutes(deps));
  app.route("/v1/mastery", createMasteryRoutes(deps));
  app.route("/v1/achievements", createAchievementsRoutes(deps));
  app.route("/v1/streak", createStreakRoutes(deps));
  app.route("/v1/activity", createActivityRoutes(deps));
  app.route("/v1/account", createAccountRoutes(deps));
  app.route("/v1/me", createMeRoutes(deps));
  app.route("/v1/temario", createTemarioRoutes(deps));
  app.route("/v1/fuentes", createFuentesRoutes(deps));
  app.route("/v1/xp", createXpRoutes(deps));

  app.notFound((c) => errorResponse(c, "not_found", "Not found"));
  app.onError((err, c) => {
    console.error("[app] unhandled error:", err);
    return errorResponse(c, "internal_error", "Internal server error");
  });

  return app;
}
