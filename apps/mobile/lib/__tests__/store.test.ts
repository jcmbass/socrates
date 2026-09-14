import { describe, expect, it } from "vitest";

import { InMemoryLocalStore } from "../localStore";
import { createAppStore } from "../store";

const SESSION = { userId: "u1", email: "ana@example.com", displayName: "Ana", token: "jwt-abc" };

describe("hydrate", () => {
  it("hydrates empty when nothing is stored", async () => {
    const store = createAppStore(new InMemoryLocalStore());
    expect(store.getState().hydrated).toBe(false);
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().auth).toBeNull();
  });

  it("restores the persisted auth session in a fresh store over the same LocalStore (resume after restart)", async () => {
    const local = new InMemoryLocalStore();
    const store = createAppStore(local);
    await store.getState().hydrate();
    await store.getState().completeLogin(SESSION);

    const reborn = createAppStore(local);
    await reborn.getState().hydrate();
    expect(reborn.getState().auth).toEqual(SESSION);
  });
});

describe("completeLogin", () => {
  it("sets auth in memory AND persists it", async () => {
    const local = new InMemoryLocalStore();
    const store = createAppStore(local);
    await store.getState().hydrate();
    await store.getState().completeLogin(SESSION);

    expect(store.getState().auth).toEqual(SESSION);
    const stored = await local.load();
    expect(stored?.auth).toEqual(SESSION);
  });
});

describe("logout", () => {
  it("clears memory and storage", async () => {
    const local = new InMemoryLocalStore();
    const store = createAppStore(local);
    await store.getState().hydrate();
    await store.getState().completeLogin(SESSION);

    await store.getState().logout();
    expect(store.getState().auth).toBeNull();
    expect(store.getState().hydrated).toBe(true);
    expect(await local.load()).toBeNull();
  });
});
