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

describe("notes", () => {
  test("authenticated user can create, read, update, and delete own note", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Test Note", content: "hello" }
    });
    expect(created.statusCode).toBe(201);
    const note = created.json();
    expect(note.version).toBe(1);

    const read = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().content).toBe("hello");
    expect(read.json().version).toBe(1);

    const updated = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "updated", baseVersion: 1 }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const deleted = await ctx.app.inject({
      method: "DELETE",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers()
    });
    expect(deleted.statusCode).toBe(200);
  });

  test("user cannot access another user's note", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const admin = await loginAs(ctx.app, "admin", "change_me_123");
    await createUserAsAdmin(ctx.app, admin.headers(), "usera", "password_123");
    await createUserAsAdmin(ctx.app, admin.headers(), "userb", "password_123");
    const userA = await loginAs(ctx.app, "usera", "password_123");
    const userB = await loginAs(ctx.app, "userb", "password_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: userA.headers(),
      payload: { title: "Shared Name", content: "secret" }
    });
    const note = created.json();

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: { cookie: userB.cookieHeader }
    });

    expect(response.statusCode).toBe(404);
  });

  test("invalid filenames are rejected", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const invalidNames = ["../secret.txt", "dir/file.txt", "dir\\file.txt", "note.md", "C:\\temp\\x.txt"];
    for (const filename of invalidNames) {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/notes/${encodeURIComponent(filename)}`,
        headers: { cookie: auth.cookieHeader }
      });
      expect([400, 404]).toContain(response.statusCode);
    }
  });

  test("stale baseVersion returns VERSION_CONFLICT and does not overwrite server content", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Versioned", content: "v1" }
    });
    const note = created.json();

    const freshSave = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "v2", baseVersion: 1 }
    });
    expect(freshSave.statusCode).toBe(200);

    const staleSave = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "stale-write", baseVersion: 1 }
    });
    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.json()).toMatchObject({
      error: "VERSION_CONFLICT",
      serverVersion: 2,
      serverContent: "v2"
    });

    const read = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(read.json().content).toBe("v2");
  });

  test("concurrent saves from the same baseVersion do not overwrite each other silently", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Concurrent", content: "v1" }
    });
    const note = created.json();

    const [first, second] = await Promise.all([
      ctx.app.inject({
        method: "PUT",
        url: `/api/notes/${encodeURIComponent(note.filename)}`,
        headers: auth.headers(),
        payload: { content: "from-a", baseVersion: 1 }
      }),
      ctx.app.inject({
        method: "PUT",
        url: `/api/notes/${encodeURIComponent(note.filename)}`,
        headers: auth.headers(),
        payload: { content: "from-b", baseVersion: 1 }
      })
    ]);

    const statuses = [first.statusCode, second.statusCode].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);

    const read = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(read.json().version).toBe(2);
    expect(["from-a", "from-b"]).toContain(read.json().content);
  });

  test("existing note without metadata gets version 1 on first read", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");
    const notePath = `${ctx.notesDir}\\admin\\legacy.txt`;
    const fs = await import("node:fs/promises");
    await fs.mkdir(`${ctx.notesDir}\\admin`, { recursive: true });
    await fs.writeFile(notePath, "legacy", "utf8");

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/notes/legacy.txt",
      headers: { cookie: auth.cookieHeader }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().version).toBe(1);
  });
});
