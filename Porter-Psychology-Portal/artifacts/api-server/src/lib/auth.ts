import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { execute, getUserById, one, type DbUser } from "./mysql";

const SESSION_COOKIE = "porter_session";
const SESSION_LENGTH_MS = 1000 * 60 * 60 * 24 * 14;

export type AuthenticatedRequest = Request & { user?: DbUser };

function readCookie(request: Request, name: string) {
  const header = request.headers.cookie ?? "";
  const entry = header
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

function cookieAttributes(maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

async function cleanExpiredSessions() {
  // Keep normal requests cheap while ensuring stale sessions are regularly removed.
  if (Math.random() < 0.01) {
    try {
      await execute(
        "DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3)",
      );
    } catch {
      // Cleanup is best-effort and must not fail an otherwise valid request.
    }
  }
}

export async function createSession(userId: number, response: Response) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_LENGTH_MS).toISOString();
  await execute(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    [token, userId, expiresAt],
  );
  await cleanExpiredSessions();
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(SESSION_LENGTH_MS / 1000)}`,
  );
}

export async function clearSession(request: Request, response: Response) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await execute("DELETE FROM sessions WHERE token = ?", [token]);
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; ${cookieAttributes(0)}`,
  );
}

export async function attachUser(request: AuthenticatedRequest) {
  if (request.user) return request.user;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return undefined;
  const session = await one<
    { user_id: number } & import("mysql2").RowDataPacket
  >(
    "SELECT user_id FROM sessions WHERE token = ? AND expires_at > UTC_TIMESTAMP(3)",
    [token],
  );
  if (!session) {
    try {
      await execute(
        "DELETE FROM sessions WHERE token = ? AND expires_at <= UTC_TIMESTAMP(3)",
        [token],
      );
    } catch {
      // Treat an absent/expired session as unauthenticated even if cleanup fails.
    }
    return undefined;
  }
  const user = await getUserById(session.user_id);
  request.user = user;
  await cleanExpiredSessions();
  return user;
}

export async function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  if (!(await attachUser(request))) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireRole(role: "admin" | "client") {
  return async (
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction,
  ) => {
    await attachUser(request);
    if (!request.user || request.user.role !== role) {
      response
        .status(403)
        .json({ error: "You do not have access to this area" });
      return;
    }
    next();
  };
}
