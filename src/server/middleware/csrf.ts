import type { FastifyRequest } from "fastify";
import { config } from "../config.js";

export function hasUnsafeCrossOrigin(request: FastifyRequest): boolean {
  const secFetchSite = request.headers["sec-fetch-site"];
  if (!request.raw.url?.startsWith("/api/")) {
    return false;
  }

  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return false;
  }

  if (secFetchSite === "cross-site") {
    return true;
  }

  if (request.raw.url.startsWith("/api/public/shares/")) {
    return false;
  }

  const origin = request.headers.origin;
  if (!origin) {
    return false;
  }

  try {
    const requestOrigin = new URL(origin);
    const appOrigin = new URL(config.appUrl);

    if (requestOrigin.origin === appOrigin.origin) {
      return false;
    }

    const localhostHosts = new Set(["localhost", "127.0.0.1"]);
    const sameLocalhostTarget =
      localhostHosts.has(requestOrigin.hostname) &&
      localhostHosts.has(appOrigin.hostname) &&
      requestOrigin.port === appOrigin.port;

    if (sameLocalhostTarget) {
      return false;
    }

    return true;
  } catch {
    return true;
  }
}

export function requiresCsrfProtection(request: FastifyRequest): boolean {
  if (!request.raw.url?.startsWith("/api/")) {
    return false;
  }

  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return false;
  }

  if (request.raw.url.startsWith("/api/public/")) {
    return false;
  }

  if (request.raw.url.startsWith("/api/auth/login")) {
    return false;
  }

  return true;
}

export function hasUnsafePublicEditRequest(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  const secFetchSite = request.headers["sec-fetch-site"];

  if (secFetchSite === "cross-site") {
    return true;
  }

  if (!origin) {
    return false;
  }

  try {
    const requestOrigin = new URL(origin);
    const appOrigin = new URL(config.appUrl);

    if (requestOrigin.origin === appOrigin.origin) {
      return false;
    }

    const localhostHosts = new Set(["localhost", "127.0.0.1"]);
    const sameLocalhostTarget =
      localhostHosts.has(requestOrigin.hostname) &&
      localhostHosts.has(appOrigin.hostname) &&
      requestOrigin.port === appOrigin.port;

    return !sameLocalhostTarget;
  } catch {
    return true;
  }
}

export function hasJsonContentType(request: FastifyRequest): boolean {
  const contentType = request.headers["content-type"];
  return typeof contentType === "string" && contentType.toLowerCase().startsWith("application/json");
}
