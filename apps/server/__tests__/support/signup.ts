import type { Hono } from "hono";
import type { AppDeps } from "../../src/deps";
import type { AuthVariables } from "../../src/auth/middleware";
import type { RecordingEmailSender } from "../../src/auth/email";
import { readJson } from "./json";

/** Full signup -> verify flow via the real HTTP routes — returns a ready-to-use bearer token. */
export async function signupAndVerify(
  app: Hono<{ Variables: AuthVariables }>,
  deps: AppDeps,
  email: string,
): Promise<{ userId: string; token: string }> {
  const signupRes = await app.request("/v1/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      ageConfirmedAt: new Date().toISOString(),
      consents: [
        { type: "terms_13plus", policyVersion: "v1" },
        { type: "privacy_policy", policyVersion: "v1" },
      ],
    }),
  });
  if (signupRes.status !== 202) throw new Error(`signup failed: ${signupRes.status} ${await signupRes.text()}`);

  const emailSender = deps.emailSender as RecordingEmailSender;
  const link = emailSender.lastLinkFor(email);
  if (!link) throw new Error(`no magic link recorded for ${email}`);
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error(`magic link has no token: ${link}`);

  const verifyRes = await app.request("/v1/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (verifyRes.status !== 200) throw new Error(`verify failed: ${verifyRes.status} ${await verifyRes.text()}`);
  return readJson<{ userId: string; token: string }>(verifyRes);
}
