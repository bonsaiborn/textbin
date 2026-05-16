import { afterEach, describe, expect, test } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { createUserAsAdmin, loginAs } from "./helpers/auth.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
});

describe("authentication", () => {
  test("login succeeds with correct credentials", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "change_me_123" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { username: "admin", role: "admin" } });
  });

  test("login fails with wrong password and returns a generic error", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong-password" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid username or password" });
  });

  test("blocked user cannot login", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const admin = await loginAs(ctx.app, "admin", "change_me_123");
    await createUserAsAdmin(ctx.app, admin.headers(), "blockeduser", "password_123");

    const usersResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: admin.headers()
    });
    const user = usersResponse.json().users.find((entry: { username: string; id: number }) => entry.username === "blockeduser");

    await ctx.app.inject({
      method: "PATCH",
      url: `/api/admin/users/${user.id}/block`,
      headers: admin.headers(),
      payload: { blocked: true }
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "blockeduser", password: "password_123" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid username or password" });
  });

  test("login rate limit triggers after repeated failed attempts", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "wrong-password" }
      });
      expect(response.statusCode).toBe(401);
    }

    const blockedResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "change_me_123" }
    });

    expect(blockedResponse.statusCode).toBe(401);
    expect(blockedResponse.json()).toEqual({ message: "Invalid username or password" });
  });

  test("logout clears the session and protected routes reject unauthenticated requests", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const logoutResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: auth.headers()
    });

    expect(logoutResponse.statusCode).toBe(200);

    const notesResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/notes",
      headers: {
        cookie: auth.cookieHeader
      }
    });

    expect(notesResponse.statusCode).toBe(401);
    expect(notesResponse.json()).toEqual({ message: "Unauthorized" });
  });

  test("failed login does not leak whether a username exists", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;

    const existing = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong-password" }
    });
    const missing = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "missing-user", password: "wrong-password" }
    });

    expect(existing.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(existing.json()).toEqual(missing.json());
  });
});
