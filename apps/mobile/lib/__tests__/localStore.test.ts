import { describe, expect, it } from "vitest";

import {
  EMPTY_STATE,
  InMemoryLocalStore,
  parsePersistedState,
  serializePersistedState,
  type PersistedAppState,
} from "../localStore";

function stateWithAuth(): PersistedAppState {
  return {
    ...EMPTY_STATE,
    auth: { userId: "u1", email: "ana@example.com", displayName: "Ana", token: "jwt-token-abc" },
  };
}

describe("parsePersistedState", () => {
  it("round-trips a valid state", () => {
    const state = stateWithAuth();
    expect(parsePersistedState(serializePersistedState(state))).toEqual(state);
  });

  it("round-trips the empty state", () => {
    expect(parsePersistedState(serializePersistedState(EMPTY_STATE))).toEqual(EMPTY_STATE);
  });

  it("returns null on invalid JSON instead of throwing", () => {
    expect(parsePersistedState("{not json")).toBeNull();
  });

  it("returns null on a wrong blob version (e.g. a WP2-era v1 blob)", () => {
    const blob = JSON.stringify({ blobVersion: 1, user: null, consents: [], courses: [], subjects: [], sessions: [], exchanges: [] });
    expect(parsePersistedState(blob)).toBeNull();
  });

  it("returns null when auth fails its schema (empty token)", () => {
    const state = stateWithAuth();
    const corrupt = JSON.parse(serializePersistedState(state)) as { auth: { token: string } };
    corrupt.auth.token = "";
    expect(parsePersistedState(JSON.stringify(corrupt))).toBeNull();
  });
});

describe("InMemoryLocalStore", () => {
  it("loads null before any save", async () => {
    expect(await new InMemoryLocalStore().load()).toBeNull();
  });

  it("saves and loads a state (through serialization)", async () => {
    const store = new InMemoryLocalStore();
    const state = stateWithAuth();
    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  it("clears", async () => {
    const store = new InMemoryLocalStore();
    await store.save(EMPTY_STATE);
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
