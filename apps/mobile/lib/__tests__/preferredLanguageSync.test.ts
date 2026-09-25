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

describe("shouldSyncPreferredLanguage (una vez por token + locale efectivo)", () => {
  it("fires when nothing was synced yet", () => {
    expect(shouldSyncPreferredLanguage(null, { token: "t", locale: "es" })).toBe(true);
    expect(shouldSyncPreferredLanguage(null, { token: "t", locale: "en" })).toBe(true);
  });

  it("skips when the same token already got the same locale", () => {
    expect(shouldSyncPreferredLanguage({ token: "t", locale: "es" }, { token: "t", locale: "es" })).toBe(false);
    expect(shouldSyncPreferredLanguage({ token: "t", locale: "en" }, { token: "t", locale: "en" })).toBe(false);
  });

  it("fires again on an actual locale change", () => {
    expect(shouldSyncPreferredLanguage({ token: "t", locale: "es" }, { token: "t", locale: "en" })).toBe(true);
    expect(shouldSyncPreferredLanguage({ token: "t", locale: "en" }, { token: "t", locale: "es" })).toBe(true);
  });

  /**
   * Bug del 2026-09-18, verificado montando el provider real en jsdom: con la
   * llave vieja (solo locale) un logout + login de OTRA cuenta sin cerrar la
   * app no sincronizaba nada, y la cuenta nueva se quedaba con la locale
   * guardada en su fila (normalmente "es") hasta el siguiente arranque en
   * frío. El PATCH escribe en la fila del dueño del token: "ya sincronicé
   * 'en'" no dice nada sobre otra fila.
   */
  it("fires again when the TOKEN changed even if the locale did not", () => {
    expect(shouldSyncPreferredLanguage({ token: "tok-A", locale: "en" }, { token: "tok-B", locale: "en" })).toBe(true);
    expect(shouldSyncPreferredLanguage({ token: "tok-A", locale: "es" }, { token: "tok-B", locale: "es" })).toBe(true);
  });
});