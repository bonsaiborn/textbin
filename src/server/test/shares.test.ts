import { afterEach, describe, expect, test } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { loginAs } from "./helpers/auth.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
});

describe("shares", () => {
  test("user can create a read-only public share and open it publicly", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Share Note", content: "hello share" }
    });
    const note = created.json();

    const shareResponse = await ctx.app.inject({
      method: "PUT",
      url: `/api/shares/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: {
        readEnabled: true,
        editEnabled: false,
        passwordEnabled: false
      }
    });
    expect(shareResponse.statusCode).toBe(200);
    const share = shareResponse.json().share;

    const publicResponse = await ctx.app.inject({
      method: "GET",
      url: `/api/public/shares/${encodeURIComponent(share.readSlug)}`
    });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json().content).toBe("hello share");
  });

  test("read-only share cannot be edited", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Read Share", content: "read" }
    });
    const note = created.json();
    const shareResponse = await ctx.app.inject({
      method: "PUT",
      url: `/api/shares/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { readEnabled: true, editEnabled: false, passwordEnabled: false }
    });
    const share = shareResponse.json().share;

    const response = await ctx.app.inject({
      method: "PUT",
      url: `/api/public/edit/${encodeURIComponent(share.readSlug)}`,
      headers: { "content-type": "application/json" },
      payload: { content: "nope", baseVersion: 1 }
    });

    expect(response.statusCode).toBe(404);
  });

  test("user can create an editable share and edit it publicly", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Editable Share", content: "before" }
    });
    const note = created.json();
    const shareResponse = await ctx.app.inject({
      method: "PUT",
      url: `/api/shares/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { readEnabled: false, editEnabled: true, passwordEnabled: false }
    });
    const share = shareResponse.json().share;

    const open = await ctx.app.inject({
      method: "GET",
      url: `/api/public/edit/${encodeURIComponent(share.editSlug)}`
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().content).toBe("before");
    expect(open.json().version).toBe(1);

    const save = await ctx.app.inject({
      method: "PUT",
      url: `/api/public/edit/${encodeURIComponent(share.editSlug)}`,
      headers: { "content-type": "application/json" },
      payload: { content: "after", baseVersion: 1 }
    });
    expect(save.statusCode).toBe(200);
    expect(save.json().version).toBe(2);

    const read = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(read.json().content).toBe("after");
  });

  test("expired, deleted, and invalid shares return 404", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Expire Me", content: "bye" }
    });
    const note = created.json();
    const shareResponse = await ctx.app.inject({
      method: "PUT",
      url: `/api/shares/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: {
        readEnabled: true,
        editEnabled: false,
        passwordEnabled: false,
        expiresAt: new Date(Date.now() - 60_000).toISOString()
      }
    });
    const share = shareResponse.json().share;

    const expired = await ctx.app.inject({
      method: "GET",
      url: `/api/public/shares/${encodeURIComponent(share.readSlug)}`
    });
    expect(expired.statusCode).toBe(404);

    await ctx.app.inject({
      method: "DELETE",
      url: `/api/shares/${encodeURIComponent(note.filename)}`,
      headers: auth.headers()
    });
    const deleted = await ctx.app.inject({
      method: "GET",
      url: `/api/public/shares/${encodeURIComponent(share.readSlug)}`
    });
    expect(deleted.statusCode).toBe(404);

    const invalid = await ctx.app.inject({
      method: "GET",
      url: "/api/public/shares/not-a-real-slug"
    });
    expect(invalid.statusCode).toBe(404);
  });

  test("editable share stale baseVersion returns VERSION_CONFLICT", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Conflict Share", content: "one" }
    });
    const note = created.json();
    const shareResponse = await ctx.app.inject({
      method: "PUT",
      url: `/api/shares/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { readEnabled: false, editEnabled: true, passwordEnabled: false }
    });
    const share = shareResponse.json().share;

    const saveOne = await ctx.app.inject({
      method: "PUT",
      url: `/api/public/edit/${encodeURIComponent(share.editSlug)}`,
      headers: { "content-type": "application/json" },
      payload: { content: "two", baseVersion: 1 }
    });
    expect(saveOne.statusCode).toBe(200);

    const staleSave = await ctx.app.inject({
      method: "PUT",
      url: `/api/public/edit/${encodeURIComponent(share.editSlug)}`,
      headers: { "content-type": "application/json" },
      payload: { content: "three", baseVersion: 1 }
    });
    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.json()).toMatchObject({
      error: "VERSION_CONFLICT",
      serverVersion: 2,
      serverContent: "two"
    });
  });
});
