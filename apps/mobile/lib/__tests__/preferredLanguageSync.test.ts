import { describe, expect, it } from "vitest";

import {
  shouldSyncPreferredLanguage,
  syncPreferredLanguage,
  type PreferredLanguageSyncClient,
} from "../preferredLanguageSync";

function fakeClient(
  behavior: (token: string, locale: "es" | "en", call: number) => Promise<void>,
): { client: PreferredLanguageSyncClient; calls: Array<{ token: string; locale: "es" | "en" }> } {
  const calls: Array<{ token: string; locale: "es" | "en" }> = [];
  return {
    calls,
    client: {
      async updatePreferredLanguage(token, locale) {
        calls.push({ token, locale });
        await behavior(token, locale, calls.length);
      },
    },
  };
}

const noDelay = () => Promise.resolve();

describe("syncPreferredLanguage", () => {
  it("PATCHes once with the token + locale on success", async () => {
    const { client, calls } = fakeClient(() => Promise.resolve());
    const ok = await syncPreferredLanguage(client, "tok-1", "en", { delay: noDelay });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ token: "tok-1", locale: "en" }]);
  });

  it("retries softly once and succeeds", async () => {
    const { client, calls } = fakeClient((_t, _l, call) =>
      call === 1 ? Promise.reject(new Error("network")) : Promise.resolve(),
    );
    const ok = await syncPreferredLanguage(client, "tok", "es", { delay: noDelay });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("never throws when every attempt fails (endpoint pending A3 → 404)", async () => {
    const { client, calls } = fakeClient(() => Promise.reject(new Error("404")));
    const ok = await syncPreferredLanguage(client, "tok", "es", { delay: noDelay });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(2); // default attempts = 2
  });

  it("respects attempts = 1 (no retry)", async () => {
    const { client, calls } = fakeClient(() => Promise.reject(new Error("nope")));
    const ok = await syncPreferredLanguage(client, "tok", "en", { attempts: 1, delay: noDelay });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("shouldSyncPreferredLanguage (moment c — una vez por locale efectivo)", () => {
  it("fires when the locale was never synced", () => {
    expect(shouldSyncPreferredLanguage(null, "es")).toBe(true);
    expect(shouldSyncPreferredLanguage(null, "en")).toBe(true);
  });

  it("skips when the effective locale is already the last synced one", () => {
    expect(shouldSyncPreferredLanguage("es", "es")).toBe(false);
    expect(shouldSyncPreferredLanguage("en", "en")).toBe(false);
  });

  it("fires again only on an actual change", () => {
    expect(shouldSyncPreferredLanguage("es", "en")).toBe(true);
    expect(shouldSyncPreferredLanguage("en", "es")).toBe(true);
  });
});