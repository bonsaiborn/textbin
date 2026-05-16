import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { createUserAsAdmin, loginAs } from "./helpers/auth.js";
import { getSubscriberCount, publishNoteUpdated, resetSyncSubscribers, subscribeToNote } from "../services/sync.service.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
  resetSyncSubscribers();
});

describe("security regressions", () => {
  test("path traversal attempts never read or write outside NOTES_DIR", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");
    const sentinelPath = path.join(ctx.rootDir, "sentinel.txt");
    await fs.writeFile(sentinelPath, "safe", "utf8");

    const readResponse = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent("../sentinel.txt")}`,
      headers: { cookie: auth.cookieHeader }
    });
    expect([400, 404]).toContain(readResponse.statusCode);

    const writeResponse = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent("../sentinel.txt")}`,
      headers: auth.headers(),
      payload: { content: "changed" }
    });
    expect([400, 404]).toContain(writeResponse.statusCode);

    const content = await fs.readFile(sentinelPath, "utf8");
    expect(content).toBe("safe");
  });

  test("user A cannot read user B note by guessing filename", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const admin = await loginAs(ctx.app, "admin", "change_me_123");
    await createUserAsAdmin(ctx.app, admin.headers(), "alice", "password_123");
    await createUserAsAdmin(ctx.app, admin.headers(), "bob", "password_123");
    const alice = await loginAs(ctx.app, "alice", "password_123");
    const bob = await loginAs(ctx.app, "bob", "password_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: alice.headers(),
      payload: { title: "private", content: "alice secret" }
    });
    const note = created.json();

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: { cookie: bob.cookieHeader }
    });
    expect(response.statusCode).toBe(404);
  });

  test("public share routes do not expose private note paths", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/public/shares/not-real"
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(ctx.notesDir);
    expect(response.body).not.toContain("data/notes");
  });

  test("authenticated note SSE endpoint rejects unauthenticated users", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/notes/test.txt/events"
    });

    expect(response.statusCode).toBe(401);
  });

  test("note update publish reaches subscribers and cleanup works", async () => {
    const received: Array<{ filename: string; version: number }> = [];
    const unsubscribe = subscribeToNote("admin", "sync.txt", (event) => {
      received.push({ filename: event.filename, version: event.version });
    }, () => {});

    expect(getSubscriberCount("admin", "sync.txt")).toBe(1);
    publishNoteUpdated("admin", "sync.txt", 3, new Date().toISOString());
    expect(received).toEqual([{ filename: "sync.txt", version: 3 }]);

    unsubscribe();
    expect(getSubscriberCount("admin", "sync.txt")).toBe(0);
  });
});
