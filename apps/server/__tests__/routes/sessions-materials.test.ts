/**
 * POST /v1/sessions/:id/materials — F2 WQ2 Part 2 deviation (see
 * `../../src/routes/sessions.ts`'s module doc "DEVIATION #2"): attach a
 * material to an ALREADY-ACTIVE session, mid-session, without creating a
 * new session or losing the tutor thread. Zero model calls.
 */
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody, SessionBody } from "../support/http-types";

interface MaterialBody {
  id: string;
  status: string;
}

describe("POST /v1/sessions/:id/materials", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setup() {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, `wq2-attach-${Math.random().toString(36).slice(2)}@example.com`);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Matemática" }) }),
    );
    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id }) }),
    );

    return { app, headers, session, subject };
  }

  async function createPasteMaterial(app: ReturnType<typeof createApp>, headers: Record<string, string>, subjectId: string, text: string) {
    const res = await app.request("/v1/materials", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "paste", subjectId, text }),
    });
    return readJson<MaterialBody>(res);
  }

  it("attaches a material to an active session and the session's material context updates", async () => {
    const { app, headers, session, subject } = await setup();
    expect(session.materialAssetIds).toEqual([]);
    expect(session.materialSnapshotTextRef).toBeNull();
    expect(session.materialEvents).toEqual([]);

    const material = await createPasteMaterial(app, headers, subject.id, "Contenido de la guía subida a mitad de sesión.");

    const res = await app.request(`/v1/sessions/${session.id}/materials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ materialAssetId: material.id }),
    });
    expect(res.status).toBe(200);
    const updated = await readJson<SessionBody>(res);

    expect(updated.materialAssetIds).toEqual([material.id]);
    expect(updated.materialSnapshotTextRef).toContain("Contenido de la guía subida a mitad de sesión.");
  });

  it("attach mid-session appends exactly one MaterialEvent, timestamped after session creation (F2 WQ3 parte C1)", async () => {
    const { app, headers, session, subject } = await setup();
    const material = await createPasteMaterial(app, headers, subject.id, "Guía de mitad de sesión.");

    const res = await app.request(`/v1/sessions/${session.id}/materials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ materialAssetId: material.id }),
    });
    const updated = await readJson<SessionBody>(res);

    expect(updated.materialEvents).toHaveLength(1);
    expect(updated.materialEvents[0]).toMatchObject({
      materialAssetId: material.id,
      // Pasted text has no filename — falls back to the fixed "Texto pegado" label (../../src/materials/events.ts).
      source: "Texto pegado",
      kind: "paste",
      action: "added",
    });
    expect(new Date(updated.materialEvents[0].timestamp).getTime()).toBeGreaterThanOrEqual(new Date(session.createdAt).getTime());
  });

  it("a second mid-session attach appends a second MaterialEvent — GET /:id returns both, chronologically ordered", async () => {
    const { app, headers, session, subject } = await setup();
    const materialA = await createPasteMaterial(app, headers, subject.id, "Primera guía.");
    await app.request(`/v1/sessions/${session.id}/materials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ materialAssetId: materialA.id }),
    });

    const materialB = await createPasteMaterial(app, headers, subject.id, "Segunda guía.");
    await app.request(`/v1/sessions/${session.id}/materials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ materialAssetId: materialB.id }),
    });

    const full = await readJson<SessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.materialEvents).toHaveLength(2);
    expect(full.materialEvents.map((e) => e.materialAssetId)).toEqual([materialA.id, materialB.id]);
    const [first, second] = full.materialEvents;
    expect(new Date(second.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(first.timestamp).getTime());
  });

  it("is idempotent: attaching the same material twice does not duplicate it", async () => {
    const { app, headers, session, subject } = await setup();
    const material = await createPasteMaterial(app, headers, subject.id, "Guía única.");

    await app.request(`/v1/sessions/${session.id}/materials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ materialAssetId: material.id }),
    });
    const res2 = await app.request(`/v1/sessions/${session.id}/materials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ materialAssetId: material.id }),
    });
    expect(res2.status).toBe(200);
    const updated = await readJson<SessionBody>(res2);
    expect(updated.materialAssetIds).toEqual([material.id]);
    // The no-op branch returns the session UNCHANGED — no duplicate MaterialEvent from the second attach.
    expect(updated.materialEvents).toHaveLength(1);
  });

  it("404s when the material doesn't belong to the user (or doesn't exist)", async () => {
    const { app, headers, session } = await setup();

    const res = await app.request(`/v1/sessions/${session.id}/materials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ materialAssetId: "nonexistent-material-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("creating a session WITH an initial materialAssetId records one MaterialEvent (F2 WQ3 parte C1)", async () => {
    const { app, headers, subject } = await setup();
    const material = await createPasteMaterial(app, headers, subject.id, "Guía inicial.");

    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectId: subject.id, materialAssetIds: [material.id] }),
    });
    expect(res.status).toBe(201);
    const created = await readJson<SessionBody>(res);

    expect(created.materialEvents).toHaveLength(1);
    expect(created.materialEvents[0]).toMatchObject({ materialAssetId: material.id, source: "Texto pegado", kind: "paste", action: "added" });
  });

  it("404s when the session doesn't belong to the user (or doesn't exist)", async () => {
    const { app, headers, subject } = await setup();
    const material = await createPasteMaterial(app, headers, subject.id, "x");

    const res = await app.request(`/v1/sessions/nonexistent-session-id/materials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ materialAssetId: material.id }),
    });
    expect(res.status).toBe(404);
  });
});
