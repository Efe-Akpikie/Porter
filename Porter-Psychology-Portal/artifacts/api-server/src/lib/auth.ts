import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { sqlite, getUserById, type DbUser } from "./sqlite";

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

export function createSession(userId: number, response: Response) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_LENGTH_MS).toISOString();
  sqlite
    .prepare(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .run(token, userId, expiresAt);
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_LENGTH_MS / 1000}`,
  );
}

export function clearSession(request: Request, response: Response) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) sqlite.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
}

export function attachUser(request: AuthenticatedRequest) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return undefined;
  const session = sqlite
    .prepare(
      "SELECT user_id, expires_at FROM sessions WHERE token = ? AND expires_at > ?",
    )
    .get(token, new Date().toISOString()) as
    | { user_id: number; expires_at: string }
    | undefined;
  if (!session) return undefined;
  const user = getUserById(session.user_id);
  request.user = user;
  return user;
}

export function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  if (!attachUser(request)) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireRole(role: "admin" | "client") {
  return (
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction,
  ) => {
    attachUser(request);
    if (!request.user || request.user.role !== role) {
      response.status(403).json({ error: "You do not have access to this area" });
      return;
    }
    next();
  };
}