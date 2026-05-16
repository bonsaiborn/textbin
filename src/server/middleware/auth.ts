import type { FastifyReply, FastifyRequest } from "fastify";
import { cleanupExpiredSessions, getAuthenticatedUser, hasValidCsrfToken, requireAuth } from "../auth.js";
import { config } from "../config.js";
import { logWarn } from "../logger.js";
import { hasJsonContentType, hasUnsafeCrossOrigin, hasUnsafePublicEditRequest, requiresCsrfProtection } from "./csrf.js";
import { isExplicitlyBlockedPath } from "./rate-limit.js";

function isAssetRequest(url: string | undefined): boolean {
  return Boolean(
    url?.startsWith("/assets/") ||
    url === "/robots.txt" ||
    url === "/site.webmanifest" ||
    url === "/favicon.ico" ||
    url?.startsWith("/icons/") ||
    url?.startsWith("/og/") ||
    url?.startsWith("/api/auth/login") ||
    url?.startsWith("/api/public/edit/") ||
    url?.startsWith("/api/public/shares/") ||
    url?.startsWith("/s/") ||
    url?.startsWith("/e/")
  );
}

export async function applyRequestGuards(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  cleanupExpiredSessions();
  reply.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  );
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  reply.header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate");
  if (request.raw.url?.startsWith("/api/")) {
    reply.header("Cache-Control", "no-store");
  }

  if (isExplicitlyBlockedPath(request.raw.url)) {
    reply.status(404).send({ message: "Not found" });
    return;
  }

  if (request.raw.url?.startsWith("/api/") && !request.raw.url.startsWith("/api/auth/login")) {
    if (request.raw.url.startsWith("/api/public/shares/")) {
      if (request.method !== "GET" && (!hasJsonContentType(request) || hasUnsafePublicEditRequest(request))) {
        reply.status(403).send({ message: "Forbidden" });
      }
      return;
    }
    if (request.raw.url.startsWith("/api/public/edit/")) {
      if (request.method !== "GET" && (!hasJsonContentType(request) || hasUnsafePublicEditRequest(request))) {
        reply.status(403).send({ message: "Forbidden" });
      }
      return;
    }
    if (hasUnsafeCrossOrigin(request)) {
      logWarn("CSRF_BLOCKED", {
        method: request.method,
        url: request.url,
        origin: request.headers.origin ?? "none",
        appUrl: config.appUrl
      });
      reply.status(403).send({ message: "Forbidden" });
      return;
    }
    await requireAuth(request, reply);
    if (reply.sent) {
      return;
    }
    if (requiresCsrfProtection(request) && !hasValidCsrfToken(request)) {
      logWarn("CSRF_BLOCKED", {
        method: request.method,
        url: request.url,
        origin: request.headers.origin ?? "none",
        secFetchSite: request.headers["sec-fetch-site"] ?? "none",
        appUrl: config.appUrl
      });
      reply.status(403).send({ message: "Forbidden" });
    }
    return;
  }

  if (!request.raw.url?.startsWith("/api/") && !isAssetRequest(request.raw.url)) {
    const user = getAuthenticatedUser(request);
    if (!user && request.raw.url !== "/" && request.raw.url !== "/login" && !request.raw.url?.startsWith("/s/")) {
      reply.redirect("/login");
      return;
    }
  }

  if (request.raw.url?.startsWith("/api/auth/login") && hasUnsafeCrossOrigin(request)) {
    logWarn("CSRF_BLOCKED", {
      method: request.method,
      url: request.url,
      origin: request.headers.origin ?? "none",
      appUrl: config.appUrl
    });
    reply.status(403).send({ message: "Forbidden" });
  }
}
