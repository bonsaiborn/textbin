import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { config } from "./config.js";
import { getDb } from "./db.js";
import type { SessionRecord, UserRecord, UserRole } from "./types.js";

const SESSION_COOKIE = "textbin_session";

export function hashToken(token: string): string {
  return crypto
    .createHmac("sha256", config.appSecret)
    .update(token)
    .digest("hex");
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argonVerify(hash, password);
}

export function getClientIp(request: FastifyRequest): string {
  return request.ip || "unknown";
}

export function isLoginBlocked(username: string, ip: string): boolean {
  const windowCutoff = new Date(Date.now() - config.loginAttemptWindowMinutes * 60_000).toISOString();
  const failures = getDb()
    .prepare(
      `SELECT created_at
       FROM login_attempts
       WHERE username = ?
         AND ip = ?
         AND success = 0
         AND created_at >= ?`
    )
    .all(username, ip, windowCutoff) as Array<{ created_at: string }>;

  if (failures.length < config.loginMaxFailedAttempts) {
    return false;
  }

  const latestFailureAt = failures
    .map((failure) => new Date(failure.created_at).getTime())
    .sort((left, right) => right - left)[0];

  return latestFailureAt >= Date.now() - config.loginBlockMinutes * 60_000;
}

export function recordLoginAttempt(username: string, ip: string, success: boolean): void {
  getDb().prepare(
    `INSERT INTO login_attempts (username, ip, success, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(username, ip, success ? 1 : 0, new Date().toISOString());
}

export function findUserByUsername(username: string): UserRecord | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRecord | undefined;
}

export function createSession(userId: number): string {
  const token = createSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60_000).toISOString();

  getDb().prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(userId, tokenHash, expiresAt, new Date().toISOString());

  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    expires: new Date(Date.now() + config.sessionDays * 24 * 60 * 60_000)
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/"
  });
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function deleteSessionByToken(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function getSessionFromRequest(request: FastifyRequest): SessionRecord | undefined {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    return undefined;
  }

  const session = getDb()
    .prepare(
      `SELECT *
       FROM sessions
       WHERE token_hash = ?
         AND expires_at > ?`
    )
    .get(hashToken(token), new Date().toISOString()) as SessionRecord | undefined;

  return session;
}

export function getAuthenticatedUser(request: FastifyRequest): UserRecord | undefined {
  const session = getSessionFromRequest(request);
  if (!session) {
    return undefined;
  }

  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as UserRecord | undefined;
}

export function cleanupExpiredSessions(): void {
  getDb()
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .run(new Date().toISOString());
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.status(401).send({ message: "Unauthorized" });
    return;
  }

  if (user.blocked) {
    reply.status(403).send({ message: "Forbidden" });
    return;
  }

  request.user = { id: user.id, username: user.username, role: user.role };
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) {
    return;
  }

  if (request.user?.role !== "admin") {
    reply.status(403).send({ message: "Forbidden" });
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: number;
      username: string;
      role: UserRole;
    };
  }
}
