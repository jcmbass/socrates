import { describe, expect, it } from "vitest";

import { InMemoryLocalePrefsStore } from "../localePrefs";

describe("InMemoryLocalePrefsStore", () => {
  it("loads null (Automático) when nothing was stored", async () => {
    expect(await new InMemoryLocalePrefsStore().load()).toBeNull();
  });

  it("round-trips both locales", async () => {
    for (const value of ["es", "en"] as const) {
      const store = new InMemoryLocalePrefsStore();
      await store.save(value);
      expect(await store.load()).toBe(value);
    }
  });

  it("save(null) clears the override", async () => {
    const store = new InMemoryLocalePrefsStore();
    await store.save("en");
    await store.save(null);
    expect(await store.load()).toBeNull();
  });

  it("keeps its blob as the same string shape AsyncStorage persists", async () => {
    const store = new InMemoryLocalePrefsStore();
    await store.save("en");
    // Mirrors the AsyncStorage binding: the raw value is the bare locale.
    expect((store as unknown as { blob: string | null }).blob).toBe("en");
  });
});