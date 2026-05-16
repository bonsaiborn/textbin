import type { FastifyInstance } from "fastify";

function toArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseCookieMap(setCookieHeaders: string[]): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const header of setCookieHeaders) {
    const [firstPart] = header.split(";", 1);
    const separatorIndex = firstPart.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = firstPart.slice(0, separatorIndex);
    const value = firstPart.slice(separatorIndex + 1);
    cookies.set(name, value);
  }
  return cookies;
}

function mergeCookieMaps(...maps: Array<Map<string, string>>) {
  const merged = new Map<string, string>();
  for (const map of maps) {
    for (const [key, value] of map.entries()) {
      merged.set(key, value);
    }
  }
  return merged;
}

export function cookieHeader(cookies: Map<string, string>): string {
  return Array.from(cookies.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

export async function loginAs(app: FastifyInstance, username: string, password: string) {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password }
  });

  const loginCookies = parseCookieMap(toArray(loginResponse.headers["set-cookie"]));
  const meResponse = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: {
      cookie: cookieHeader(loginCookies)
    }
  });
  const meCookies = parseCookieMap(toArray(meResponse.headers["set-cookie"]));
  const cookies = mergeCookieMaps(loginCookies, meCookies);
  const csrfToken = cookies.get("textbin_csrf") ?? "";

  return {
    loginResponse,
    meResponse,
    cookies,
    csrfToken,
    cookieHeader: cookieHeader(cookies),
    headers(extra: Record<string, string> = {}) {
      return {
        cookie: cookieHeader(cookies),
        "x-csrf-token": csrfToken,
        ...extra
      };
    }
  };
}

export async function createUserAsAdmin(
  app: FastifyInstance,
  adminHeaders: Record<string, string>,
  username: string,
  password: string,
  role: "admin" | "user" = "user"
) {
  return app.inject({
    method: "POST",
    url: "/api/admin/users",
    headers: adminHeaders,
    payload: { username, password, role }
  });
}
