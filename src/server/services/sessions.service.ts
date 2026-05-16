import type { FastifyReply, FastifyRequest } from "fastify";
import { clearCsrfCookie, clearSessionCookie, deleteSessionById, deleteSessionsForUser, getCurrentSessionId, getSessionById, listSessionsForUser } from "../auth.js";
import type { SessionRecord } from "../types.js";

export function toSessionSummary(session: SessionRecord, currentSessionId?: number) {
  return {
    id: session.id,
    current: session.id === currentSessionId,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    lastUsedAt: session.last_used_at ?? session.created_at,
    ip: session.ip ?? "unknown",
    userAgent: session.user_agent ?? "unknown"
  };
}

export function listOwnSessionSummaries(userId: number, currentSessionId?: number) {
  return listSessionsForUser(userId).map((session) => toSessionSummary(session, currentSessionId));
}

export function revokeOwnSession(sessionId: number, userId: number, request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionById(sessionId);
  if (!session || session.user_id !== userId) {
    return { status: 404 as const };
  }

  const currentSessionId = getCurrentSessionId(request);
  deleteSessionById(sessionId);
  if (currentSessionId === sessionId) {
    clearSessionCookie(reply);
    clearCsrfCookie(reply);
  }

  return { status: 200 as const, revokedCurrent: currentSessionId === sessionId };
}

export function revokeOtherSessions(userId: number, currentSessionId?: number) {
  deleteSessionsForUser(userId, currentSessionId);
}

export function revokeAdminSession(sessionId: number, request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionById(sessionId);
  if (!session) {
    return { status: 404 as const };
  }

  const currentSessionId = getCurrentSessionId(request);
  deleteSessionById(sessionId);
  if (currentSessionId === sessionId) {
    clearSessionCookie(reply);
    clearCsrfCookie(reply);
  }

  return { status: 200 as const };
}
