import fs from "node:fs/promises";
import path from "node:path";
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

describe("revisions", () => {
  test("updating an existing note creates a revision of the previous content", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "History", content: "v1" }
    });
    const note = created.json();

    const updated = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "v2", baseVersion: 1 }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().revisions).toEqual([
      expect.objectContaining({
        version: 1
      })
    ]);

    const revisionFile = path.join(ctx.notesDir, "admin", ".revision", note.filename, "1.txt");
    expect(await fs.readFile(revisionFile, "utf8")).toBe("v1");
  });

  test("creating a new note and no-op save do not create unnecessary revisions", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Noop", content: "same" }
    });
    const note = created.json();

    let revisions = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(revisions.json().revisions).toEqual([]);

    const noopSave = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "same", baseVersion: 1 }
    });
    expect(noopSave.statusCode).toBe(200);
    expect(noopSave.json().version).toBe(1);

    revisions = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(revisions.json().revisions).toEqual([]);
  });

  test("conflict save does not create a revision", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Conflict Revision", content: "v1" }
    });
    const note = created.json();

    await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "v2", baseVersion: 1 }
    });

    const stale = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "stale", baseVersion: 1 }
    });
    expect(stale.statusCode).toBe(409);

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(revisions.json().revisions).toHaveLength(1);
  });

  test("single revision read and restore work and increment note version", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Restore", content: "v1" }
    });
    const note = created.json();

    await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "v2", baseVersion: 1 }
    });
    const third = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "v3", baseVersion: 2 }
    });
    expect(third.json().version).toBe(3);

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: { cookie: auth.cookieHeader }
    });
    const revision = revisions.json().revisions.find((item: { version: number }) => item.version === 1);
    expect(revision).toBeTruthy();

    const preview = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions/${revision.id}`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().content).toBe("v1");

    const restored = await ctx.app.inject({
      method: "POST",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions/${revision.id}/restore`,
      headers: auth.headers(),
      payload: { baseVersion: 3 }
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      version: 4,
      content: "v1"
    });

    const read = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(read.json().content).toBe("v1");
    expect(read.json().version).toBe(4);
  });

  test("users cannot read or restore another user's revisions", async () => {
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
      payload: { title: "Secret History", content: "v1" }
    });
    const note = created.json();
    await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: alice.headers(),
      payload: { content: "v2", baseVersion: 1 }
    });

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: { cookie: alice.cookieHeader }
    });
    const revisionId = revisions.json().revisions[0].id;

    const readDenied = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions/${revisionId}`,
      headers: { cookie: bob.cookieHeader }
    });
    expect(readDenied.statusCode).toBe(404);

    const restoreDenied = await ctx.app.inject({
      method: "POST",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions/${revisionId}/restore`,
      headers: bob.headers(),
      payload: { baseVersion: 2 }
    });
    expect(restoreDenied.statusCode).toBe(404);
  });

  test("path traversal is rejected and clearing history removes tracked revision files", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Cleanup", content: "v1" }
    });
    const note = created.json();
    await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "v2", baseVersion: 1 }
    });

    const invalid = await ctx.app.inject({
      method: "GET",
      url: "/api/notes/../secret.txt/revisions",
      headers: { cookie: auth.cookieHeader }
    });
    expect([400, 404]).toContain(invalid.statusCode);

    const cleared = await ctx.app.inject({
      method: "DELETE",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: auth.headers()
    });
    expect(cleared.statusCode).toBe(200);

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(revisions.json().revisions).toEqual([]);
  });

  test("unauthenticated and public share access cannot reach private revision history", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Hidden History", content: "v1" }
    });
    const note = created.json();

    await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "v2", baseVersion: 1 }
    });

    const unauthenticated = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`
    });
    expect(unauthenticated.statusCode).toBe(401);

    const shareResponse = await ctx.app.inject({
      method: "PUT",
      url: `/api/shares/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { readEnabled: false, editEnabled: true, passwordEnabled: false }
    });
    const share = shareResponse.json().share;

    const publicEditRead = await ctx.app.inject({
      method: "GET",
      url: `/api/public/edit/${encodeURIComponent(share.editSlug)}`
    });
    expect(publicEditRead.statusCode).toBe(200);

    const stillPrivate = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`
    });
    expect(stillPrivate.statusCode).toBe(401);
  });

  test("editable public share saves create owner revisions", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Public History", content: "v1" }
    });
    const note = created.json();

    const shareResponse = await ctx.app.inject({
      method: "PUT",
      url: `/api/shares/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { readEnabled: false, editEnabled: true, passwordEnabled: false }
    });
    const share = shareResponse.json().share;

    const save = await ctx.app.inject({
      method: "PUT",
      url: `/api/public/edit/${encodeURIComponent(share.editSlug)}`,
      headers: { "content-type": "application/json" },
      payload: { content: "v2", baseVersion: 1 }
    });
    expect(save.statusCode).toBe(200);

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(note.filename)}/revisions`,
      headers: { cookie: auth.cookieHeader }
    });
    expect(revisions.json().revisions).toHaveLength(1);
    expect(revisions.json().revisions[0].version).toBe(1);
  });

  test("max revision setting defaults, can be updated, can disable history, and prunes safely", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const admin = await loginAs(ctx.app, "admin", "change_me_123");

    const settings = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/settings",
      headers: admin.headers()
    });
    expect(settings.json().settings.maxNoteRevisions).toBe(20);

    const invalid = await ctx.app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      headers: admin.headers(),
      payload: {
        ...settings.json().settings,
        maxNoteRevisions: 999
      }
    });
    expect(invalid.statusCode).toBe(400);

    const updated = await ctx.app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      headers: admin.headers(),
      payload: {
        ...settings.json().settings,
        maxNoteRevisions: 2
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings.maxNoteRevisions).toBe(2);

    const noteA = (await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: admin.headers(),
      payload: { title: "Prune A", content: "v1" }
    })).json();
    const noteB = (await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: admin.headers(),
      payload: { title: "Prune B", content: "b1" }
    })).json();

    let versionA = 1;
    for (const content of ["v2", "v3", "v4"]) {
      const response = await ctx.app.inject({
        method: "PUT",
        url: `/api/notes/${encodeURIComponent(noteA.filename)}`,
        headers: admin.headers(),
        payload: { content, baseVersion: versionA }
      });
      versionA = response.json().version;
    }

    await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(noteB.filename)}`,
      headers: admin.headers(),
      payload: { content: "b2", baseVersion: 1 }
    });

    const revisionsA = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(noteA.filename)}/revisions`,
      headers: { cookie: admin.cookieHeader }
    });
    expect(revisionsA.json().revisions.map((revision: { version: number }) => revision.version)).toEqual([3, 2]);

    const oldFile = path.join(ctx.notesDir, "admin", ".revision", noteA.filename, "1.txt");
    await expect(fs.access(oldFile)).rejects.toThrow();

    const revisionsB = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(noteB.filename)}/revisions`,
      headers: { cookie: admin.cookieHeader }
    });
    expect(revisionsB.json().revisions.map((revision: { version: number }) => revision.version)).toEqual([1]);

    const disabled = await ctx.app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      headers: admin.headers(),
      payload: {
        defaultTheme: "dark",
        defaultReadSlugLength: 8,
        defaultEditSlugLength: 16,
        shareCharset: "abcdefghijklmnopqrstuvwxyz0123456789",
        maxNoteRevisions: 0
      }
    });
    expect(disabled.statusCode).toBe(200);

    const noteDisabled = (await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: admin.headers(),
      payload: { title: "Disabled history", content: "x1" }
    })).json();

    const savedDisabled = await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(noteDisabled.filename)}`,
      headers: admin.headers(),
      payload: { content: "x2", baseVersion: 1 }
    });
    expect(savedDisabled.statusCode).toBe(200);

    const revisionsDisabled = await ctx.app.inject({
      method: "GET",
      url: `/api/notes/${encodeURIComponent(noteDisabled.filename)}/revisions`,
      headers: { cookie: admin.cookieHeader }
    });
    expect(revisionsDisabled.json().revisions).toEqual([]);
  });

  test("deleting a note cleans up its revisions", async () => {
    const ctx = await createTestApp();
    cleanup = ctx.cleanup;
    const auth = await loginAs(ctx.app, "admin", "change_me_123");

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      headers: auth.headers(),
      payload: { title: "Delete history", content: "v1" }
    });
    const note = created.json();
    await ctx.app.inject({
      method: "PUT",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers(),
      payload: { content: "v2", baseVersion: 1 }
    });

    await ctx.app.inject({
      method: "DELETE",
      url: `/api/notes/${encodeURIComponent(note.filename)}`,
      headers: auth.headers()
    });

    const revisionPath = path.join(ctx.notesDir, "admin", ".revision", note.filename);
    await expect(fs.access(revisionPath)).rejects.toThrow();
  });
});
