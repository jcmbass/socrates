import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import { findUserById } from "../../src/repositories/users";
import { listCoursesByUser } from "../../src/repositories/courses";
import { listSubjectsByUser } from "../../src/repositories/subjects";
import { listMaterialsByUser } from "../../src/repositories/materials";
import { listAllStudySessionsByUser } from "../../src/repositories/study-sessions";

interface ExportBody {
  user: { authIdentifiers: Array<{ value: string }> };
  courses: unknown[];
  consents: Array<{ type: string }>;
}

describe("DELETE /v1/account and GET /v1/account/export (§5.3, A7)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("export returns the user's own data snapshot", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "export@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) });

    const res = await app.request("/v1/account/export", { headers });
    expect(res.status).toBe(200);
    const body = await readJson<ExportBody>(res);
    expect(body.user.authIdentifiers[0].value).toBe("export@example.com");
    expect(body.courses).toHaveLength(1);
    expect(body.consents.map((c: { type: string }) => c.type).sort()).toEqual(["privacy_policy", "terms_13plus"]);
  });

  it("export includes the tutor opening for each session (mensajes)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "export-opening@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<{ id: string }>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física 1" }) }),
    );
    const topic = await readJson<{ id: string }>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "MRU" }),
      }),
    );
    const session = await readJson<{ id: string }>(
      await app.request("/v1/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({ subjectId: subject.id, topicId: topic.id }),
      }),
    );
    const { createSessionOpening } = await import("../../src/repositories/session-openings");
    await createSessionOpening(ctx.deps.db, {
      sessionId: session.id,
      userId,
      text: "Una idea breve exportada. ¿Qué pasa si duplicás x?",
      tutorPromptVersion: "buxo-socratic-v3",
      tutorModelId: "fake",
      tutorProviderId: "fake",
      grounding: "general",
    });

    const res = await app.request("/v1/account/export", { headers });
    expect(res.status).toBe(200);
    const body = await readJson<{
      sessions: Array<{ id: string; opening: { text: string; grounding: string } | null }>;
    }>(res);
    const exported = body.sessions.find((s) => s.id === session.id);
    expect(exported?.opening?.text).toBe("Una idea breve exportada. ¿Qué pasa si duplicás x?");
    expect(exported?.opening?.grounding).toBe("general");
  });

  it("delete tombstones the account and pseudonymizes consents (R-8), never purging them", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { userId, token } = await signupAndVerify(app, ctx.deps, "delete-me@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const res = await app.request("/v1/account", { method: "DELETE", headers });
    expect(res.status).toBe(202);

    const user = await findUserById(ctx.deps.db, userId);
    expect(user?.accountStatus).toBe("deleted");
    expect(user?.deletedAt).not.toBeNull();

    // Consents survive (I-6, R-8) but userId is pseudonymized — no longer findable by the real userId.
    const { listConsentsByUser } = await import("../../src/repositories/consents");
    const consentsByRealId = await listConsentsByUser(ctx.deps.db, userId);
    expect(consentsByRealId).toHaveLength(0);

    const { consents } = await import("../../src/db/schema");
    const allConsents = await ctx.deps.db.select().from(consents);
    expect(allConsents.length).toBeGreaterThan(0);
    expect(allConsents.every((c) => c.userId.startsWith("pseudo_"))).toBe(true);
  });

  it("delete purges study rows and the same JWT then returns 401", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { userId, token } = await signupAndVerify(app, ctx.deps, "purge-me@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<{ id: string }>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física 1" }) }),
    );
    const topic = await readJson<{ id: string }>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "MRU" }),
      }),
    );
    await app.request("/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectId: subject.id, topicId: topic.id }),
    });

    const res = await app.request("/v1/account", { method: "DELETE", headers });
    expect(res.status).toBe(202);

    expect(await listAllStudySessionsByUser(ctx.deps.db, userId)).toHaveLength(0);
    expect(await listMaterialsByUser(ctx.deps.db, userId)).toHaveLength(0);
    expect(await listSubjectsByUser(ctx.deps.db, userId)).toHaveLength(0);
    expect(await listCoursesByUser(ctx.deps.db, userId)).toHaveLength(0);

    const later = await app.request("/v1/sessions", { headers });
    expect(later.status).toBe(401);
  });

  /**
   * R11 (beta lote 3): el tombstone conserva su `primaryEmail` para
   * auditoría, pero deja de OCUPARLO. La contraparte end-to-end
   * (borrar → volver a registrarse) vive en routes/auth.test.ts.
   */
  it("delete frees the email for re-registration while keeping the tombstone's own copy", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const email = "free-my-email@example.com";
    const { userId, token } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const { findUserByEmail } = await import("../../src/repositories/users");
    expect((await findUserByEmail(ctx.deps.db, email))?.id).toBe(userId);

    expect((await app.request("/v1/account", { method: "DELETE", headers })).status).toBe(202);

    // Los flujos de auth ya no ven la fila...
    expect(await findUserByEmail(ctx.deps.db, email)).toBeNull();
    // ...pero la fila sigue ahí, con su correo original sin mutar.
    const { users } = await import("../../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await ctx.deps.db.select().from(users).where(eq(users.id, userId));
    expect(row.accountStatus).toBe("deleted");
    expect(row.primaryEmail).toBe(email);
  });
});
