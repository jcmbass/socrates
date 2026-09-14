import type { MiddlewareHandler } from "hono";
import { verifySessionToken, type CreateSessionDeps } from "./session";
import { errorResponse } from "../errors";
import type { Db } from "../db/client";
import { findUserById } from "../repositories/users";

export interface AuthVariables {
  userId: string;
}

/**
 * Bearer-auth middleware (C-backend §2.4: "token bearer por sesión").
 * Extracts+verifies the JWT, sets `userId` on the Hono context for every
 * downstream handler/middleware (quota, routes) to read via `c.get("userId")`.
 */
export function requireAuth(deps: {
  db: Db;
  sessionDeps: Pick<CreateSessionDeps, "secret" | "issuer">;
}): MiddlewareHandler<{
  Variables: AuthVariables;
}> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      return errorResponse(c, "unauthorized", "Missing or malformed Authorization header");
    }
    const token = header.slice("Bearer ".length).trim();
    const result = await verifySessionToken(deps.sessionDeps, token);
    if (!result.ok) {
      return errorResponse(c, "unauthorized", result.reason === "expired" ? "Session token expired" : "Invalid session token");
    }
    const user = await findUserById(deps.db, result.userId);
    if (!user || user.accountStatus === "deleted") {
      return errorResponse(c, "unauthorized", "Invalid session token");
    }
    c.set("userId", result.userId);
    await next();
  };
}
