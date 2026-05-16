import type { FastifyReply, FastifyRequest } from "fastify";
import { getClientIp } from "../auth.js";
import { logError, logWarn } from "../logger.js";

export function isErrorWithMessage(value: unknown): value is Error {
  return value instanceof Error;
}

export function isErrorWithCode(value: unknown): value is Error & { code?: string } {
  return value instanceof Error;
}

export function registerAppErrorHandler(app: {
  setErrorHandler: (handler: (error: unknown, request: FastifyRequest, reply: FastifyReply) => void) => void;
}): void {
  app.setErrorHandler((error, request, reply) => {
    const message = isErrorWithMessage(error) ? error.message : "Internal server error";
    const isValidationLike =
      message === "Invalid filename" ||
      message === "Invalid username" ||
      message === "Invalid settings" ||
      message === "Invalid share slug" ||
      message === "Invalid share expiration" ||
      message === "Share password is required" ||
      message === "Could not generate unique share slug" ||
      message === "Share slug already exists" ||
      message === "RESET_ADMIN_ON_START username conflicts with an existing user" ||
      message === "Note exceeds maximum size";
    const notFound = isErrorWithCode(error) && error.code === "ENOENT";
    const notFoundByMessage = message === "Share not found" || message === "Revision not found";
    const authByMessage = message === "Invalid share password";
    const rateLimitedByMessage = message === "Public link rate limited" || message === "Public edit rate limited";
    const statusCode = rateLimitedByMessage ? 429 : authByMessage ? 401 : notFound || notFoundByMessage ? 404 : isValidationLike ? 400 : 500;

    if (message === "Public edit rate limited") {
      logWarn("PUBLIC_EDIT_RATE_LIMITED", {
        slug: typeof (request.params as { slug?: string } | undefined)?.slug === "string" ? (request.params as { slug?: string }).slug : "unknown",
        ip: getClientIp(request),
        userAgent: request.headers["user-agent"] ?? "unknown"
      });
    }

    if (message === "Public link rate limited") {
      logWarn("PUBLIC_SHARE_RATE_LIMITED", {
        slug: typeof (request.params as { slug?: string } | undefined)?.slug === "string" ? (request.params as { slug?: string }).slug : "unknown",
        ip: getClientIp(request),
        userAgent: request.headers["user-agent"] ?? "unknown"
      });
    }

    logError("REQUEST_ERROR", {
      method: request.method,
      url: request.url,
      username: request.user?.username ?? "unknown",
      status: statusCode,
      message
    });

    reply.status(statusCode).send({
      message: rateLimitedByMessage ? "Too many attempts" : notFound ? "Not found" : authByMessage ? "Invalid password" : isValidationLike ? message : "Internal server error"
    });
  });
}
