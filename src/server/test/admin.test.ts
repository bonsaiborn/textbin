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

describe("admin", () => {
  test("admin can create a user", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const admin = await loginAs(ctx.app, "admin", "change_me_123");

    const response = await createUserAsAdmin(ctx.app, admin.headers(), "newuser", "password_123");
    expect(response.statusCode).toBe(201);
    expect(response.json().user.username).toBe("newuser");
  });

  test("admin can block a user", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const admin = await loginAs(ctx.app, "admin", "change_me_123");
    await createUserAsAdmin(ctx.app, admin.headers(), "blockme", "password_123");
    const usersResponse = await ctx.app.inject({ method: "GET", url: "/api/admin/users", headers: admin.headers() });
    const target = usersResponse.json().users.find((user: { username: string; id: number }) => user.username === "blockme");

    const response = await ctx.app.inject({
      method: "PATCH",
      url: `/api/admin/users/${target.id}/block`,
      headers: admin.headers(),
      payload: { blocked: true }
    });

    expect(response.statusCode).toBe(200);
  });

  test("admin can revoke user sessions", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const admin = await loginAs(ctx.app, "admin", "change_me_123");
    await createUserAsAdmin(ctx.app, admin.headers(), "sessionuser", "password_123");
    const user = await loginAs(ctx.app, "sessionuser", "password_123");

    const usersResponse = await ctx.app.inject({ method: "GET", url: "/api/admin/users", headers: admin.headers() });
    const target = usersResponse.json().users.find((entry: { username: string; id: number }) => entry.username === "sessionuser");
    const sessionsResponse = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/users/${target.id}/sessions`,
      headers: admin.headers()
    });
    const session = sessionsResponse.json().sessions[0];

    const revokeResponse = await ctx.app.inject({
      method: "DELETE",
      url: `/api/admin/sessions/${session.id}`,
      headers: admin.headers()
    });
    expect(revokeResponse.statusCode).toBe(200);

    const denied = await ctx.app.inject({
      method: "GET",
      url: "/api/notes",
      headers: { cookie: user.cookieHeader }
    });
    expect(denied.statusCode).toBe(401);
  });

  test("regular user cannot access admin routes", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const admin = await loginAs(ctx.app, "admin", "change_me_123");
    await createUserAsAdmin(ctx.app, admin.headers(), "plainuser", "password_123");
    const user = await loginAs(ctx.app, "plainuser", "password_123");

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: user.headers()
    });

    expect(response.statusCode).toBe(403);
  });
});
