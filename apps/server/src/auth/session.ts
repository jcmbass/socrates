/**
 * Bearer session tokens — signed JWTs (self-hosted, DF-6.2: "sin Supabase
 * Auth"), stateless (no server-side session table to revoke against in F1;
 * a real deployment would likely add a revocation list — out of scope here,
 * same as the rest of C6's operational maturity). `jose` is used instead of
 * hand-rolling HMAC framing.
 */
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

export interface SessionClaims {
  sub: string; // userId
}

export interface CreateSessionDeps {
  secret: string;
  issuer: string;
  ttlSeconds: number;
}

export async function issueSessionToken(deps: CreateSessionDeps, userId: string): Promise<string> {
  const key = new TextEncoder().encode(deps.secret);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(deps.issuer)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + deps.ttlSeconds)
    .sign(key);
}

export type VerifySessionResult = { ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" };

export async function verifySessionToken(
  deps: Pick<CreateSessionDeps, "secret" | "issuer">,
  token: string,
): Promise<VerifySessionResult> {
  const key = new TextEncoder().encode(deps.secret);
  try {
    const { payload } = await jwtVerify(token, key, { issuer: deps.issuer });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return { ok: false, reason: "invalid" };
    return { ok: true, userId: payload.sub };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
