import type { FastifyRequest } from "fastify";

export const PUBLIC_EDIT_GRANT_HEADER = "x-public-edit-grant";

export function getPublicEditGrant(request: FastifyRequest): string | undefined {
  const header = request.headers[PUBLIC_EDIT_GRANT_HEADER];
  return typeof header === "string" && header.trim() ? header.trim() : undefined;
}
