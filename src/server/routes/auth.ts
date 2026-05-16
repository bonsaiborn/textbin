import type { FastifyInstance } from "fastify";
import { clearCsrfCookie, clearSessionCookie, createSession, deleteSessionByToken, findUserByUsername, getAuthenticatedUser, getClientIp, getCurrentSessionId, getSessionCookieName, hashPassword, isLoginBlocked, recordLoginAttempt, rotateCurrentSession, setSessionCookie, verifyPassword } from "../auth.js";
import { getDb } from "../db.js";
import { logInfo, logWarn } from "../logger.js";
import { listOwnSessionSummaries, revokeOtherSessions, revokeOwnSession } from "../services/sessions.service.js";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { username?: unknown; password?: unknown };
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const ip = getClientIp(request);
    if (!username || !password || isLoginBlocked(username, ip)) {
      logWarn("BLOCKED_LOGIN", {
        username: username || "unknown",
        ip
      });
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    const user = findUserByUsername(username);
    const isValid = user ? await verifyPassword(user.password_hash, password) : false;

    if (user?.blocked) {
      recordLoginAttempt(username, ip, false);
      logWarn("BLOCKED_LOGIN", {
        username,
        ip
      });
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    recordLoginAttempt(username, ip, isValid);

    if (!user || !isValid) {
      logWarn("FAILED_LOGIN", {
        username,
        ip
      });
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    const token = createSession(user.id, ip, request.headers["user-agent"] ?? undefined);
    setSessionCookie(reply, token);
    logInfo("LOGIN", {
      username: user.username,
      ip,
      role: user.role
    });
    return reply.send({ user: { username: user.username, role: user.role } });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[getSessionCookieName()];
    const user = getAuthenticatedUser(request);
    if (token) {
      deleteSessionByToken(token);
    }
    clearSessionCookie(reply);
    clearCsrfCookie(reply);
    logInfo("LOGOUT", {
      username: user?.username ?? "unknown",
      ip: getClientIp(request)
    });
    return reply.send({ success: true });
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = getAuthenticatedUser(request);
    if (!user) {
      return reply.status(401).send({ message: "Unauthorized" });
    }
    return reply.send({ user: { username: user.username, role: user.role } });
  });

  app.get("/api/me/sessions", async (request, reply) => {
    const currentSessionId = getCurrentSessionId(request);
    return reply.send({ sessions: listOwnSessionSummaries(request.user!.id, currentSessionId) });
  });

  app.delete("/api/me/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number.parseInt(id, 10);
    if (!Number.isFinite(numericId)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const result = revokeOwnSession(numericId, request.user!.id, request, reply);
    if (result.status === 404) {
      return reply.status(404).send({ message: "Not found" });
    }

    return reply.send({ success: true, revokedCurrent: result.revokedCurrent });
  });

  app.post("/api/me/sessions/revoke-others", async (request, reply) => {
    revokeOtherSessions(request.user!.id, getCurrentSessionId(request));
    return reply.send({ success: true });
  });

  app.post("/api/me/password", async (request, reply) => {
    const body = request.body as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || newPassword.length < 8) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const user = findUserByUsername(request.user!.username);
    if (!user) {
      return reply.status(404).send({ message: "Not found" });
    }

    const valid = await verifyPassword(user.password_hash, currentPassword);
    if (!valid) {
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    const passwordHash = await hashPassword(newPassword);
    getDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, new Date().toISOString(), user.id);
    rotateCurrentSession(request, reply);
    logInfo("PASSWORD_CHANGED", {
      username: user.username,
      ip: getClientIp(request)
    });
    return reply.send({ success: true });
  });
}
