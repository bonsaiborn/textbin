import type { FastifyInstance } from "fastify";
import { clearCsrfCookie, clearSessionCookie, deleteSessionsForUser, listSessionsForUser, requireAdmin } from "../auth.js";
import { getDb, getInstanceSettings, updateInstanceSettings } from "../db.js";
import { logInfo } from "../logger.js";
import { deleteNote, getDownloadPayload, listNotesForUser, parseSortMode, renameNote } from "../services/notes.service.js";
import { clearRevisionsForNote, renameRevisionsForNote } from "../services/revisions.service.js";
import { deleteShareById, deleteShareForUser, getShareById, listAllSharesWithUsers, renameShareFilenameForUser, updateShareById } from "../services/shares.service.js";
import { revokeAdminSession, toSessionSummary } from "../services/sessions.service.js";
import { buildUserSummary, createUserAccount, findUserByUsername, getUserById, normalizeUsername, parseBooleanFlag, parseRole, updateUserBlocked, updateUserPassword, updateUserRole, deleteUserAccount } from "../services/users.service.js";
import type { InstanceSettings, UserRecord, UserRole } from "../types.js";

function validateSettings(body: Record<string, unknown>): InstanceSettings {
  const defaultTheme =
    body.defaultTheme === "light"
      ? "light"
      : body.defaultTheme === "dark"
        ? "dark"
        : body.defaultTheme === "system"
          ? "system"
          : undefined;
  const defaultReadSlugLength =
    typeof body.defaultReadSlugLength === "number"
      ? body.defaultReadSlugLength
      : Number.parseInt(String(body.defaultReadSlugLength ?? ""), 10);
  const defaultEditSlugLength =
    typeof body.defaultEditSlugLength === "number"
      ? body.defaultEditSlugLength
      : Number.parseInt(String(body.defaultEditSlugLength ?? ""), 10);
  const shareCharset = typeof body.shareCharset === "string" ? body.shareCharset : undefined;
  const maxNoteRevisions =
    typeof body.maxNoteRevisions === "number"
      ? body.maxNoteRevisions
      : Number.parseInt(String(body.maxNoteRevisions ?? ""), 10);

  if (
    !defaultTheme ||
    !Number.isFinite(defaultReadSlugLength) ||
    defaultReadSlugLength < 8 ||
    defaultReadSlugLength > 64 ||
    !Number.isFinite(defaultEditSlugLength) ||
    defaultEditSlugLength < 16 ||
    defaultEditSlugLength > 64 ||
    !shareCharset ||
    shareCharset.length === 0 ||
    shareCharset.length > 128 ||
    !Number.isFinite(maxNoteRevisions) ||
    maxNoteRevisions < 0 ||
    maxNoteRevisions > 500
  ) {
    throw new Error("Invalid settings");
  }

  return {
    defaultTheme,
    defaultReadSlugLength,
    defaultEditSlugLength,
    shareCharset,
    maxNoteRevisions
  };
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/users", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const users = getDb().prepare("SELECT * FROM users ORDER BY id ASC").all() as UserRecord[];
    return reply.send({
      users: await Promise.all(users.map((user) => buildUserSummary(user)))
    });
  });

  app.post("/api/admin/users", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const body = request.body as { username?: unknown; password?: unknown; role?: unknown };
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    const role = parseRole(body.role);

    if (!username || password.length < 8 || !role) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    if (findUserByUsername(username)) {
      return reply.status(409).send({ message: "Username already exists" });
    }

    const user = await createUserAccount(username, password, role);
    logInfo("USER_CREATED", {
      admin: request.user!.username,
      username,
      role
    });

    return reply.status(201).send({ user });
  });

  app.patch("/api/admin/users/:id/password", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { id } = request.params as { id: string };
    const body = request.body as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const target = getUserById(id);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    await updateUserPassword(id, password);
    deleteSessionsForUser(target.id);
    logInfo("USER_PASSWORD_RESET", {
      admin: request.user!.username,
      username: target.username
    });
    return reply.send({ success: true });
  });

  app.patch("/api/admin/users/:id/role", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { id } = request.params as { id: string };
    const body = request.body as { role?: unknown };
    const role = parseRole(body.role);
    if (!role) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const target = getUserById(id);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    if (target.id === request.user!.id && role !== "admin") {
      return reply.status(400).send({ message: "Cannot demote current admin session" });
    }

    updateUserRole(id, role);
    logInfo("USER_ROLE_UPDATED", {
      admin: request.user!.username,
      username: target.username,
      role
    });
    return reply.send({ success: true });
  });

  app.patch("/api/admin/users/:id/block", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { id } = request.params as { id: string };
    const body = request.body as { blocked?: unknown };
    const blocked = parseBooleanFlag(body.blocked);
    if (blocked === undefined) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const target = getUserById(id);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    if (target.id === request.user!.id && blocked) {
      return reply.status(400).send({ message: "Cannot block current admin session" });
    }

    updateUserBlocked(id, blocked);
    if (blocked) {
      deleteSessionsForUser(target.id);
    }
    logInfo(blocked ? "USER_BLOCKED" : "USER_UNBLOCKED", {
      admin: request.user!.username,
      username: target.username
    });
    return reply.send({ success: true });
  });

  app.delete("/api/admin/users/:id", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { id } = request.params as { id: string };
    const target = getUserById(id);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    if (target.id === request.user!.id) {
      return reply.status(400).send({ message: "Cannot delete current admin session" });
    }

    deleteSessionsForUser(target.id);
    deleteUserAccount(id, target.username);
    logInfo("USER_DELETED", {
      admin: request.user!.username,
      username: target.username
    });
    return reply.send({ success: true });
  });

  app.get("/api/admin/settings", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    return reply.send({ settings: getInstanceSettings() });
  });

  app.put("/api/admin/settings", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const body = request.body as Record<string, unknown>;
    const settings = validateSettings(body);
    const updated = updateInstanceSettings(settings);
    logInfo("SETTINGS_UPDATED", {
      admin: request.user!.username,
      defaultTheme: updated.defaultTheme,
      defaultReadSlugLength: updated.defaultReadSlugLength,
      defaultEditSlugLength: updated.defaultEditSlugLength,
      maxNoteRevisions: updated.maxNoteRevisions
    });
    return reply.send({ settings: updated });
  });

  app.get("/api/admin/notes", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const query = request.query as { username?: string; sort?: string };
    const username = normalizeUsername(query.username ?? request.user!.username);
    if (!username) {
      return reply.status(400).send({ message: "Invalid username" });
    }

    const target = findUserByUsername(username);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    return reply.send({
      notes: await listNotesForUser(username, parseSortMode(query.sort)),
      user: {
        username: target.username,
        role: target.role
      }
    });
  });

  app.get("/api/admin/shares", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    return reply.send({
      shares: listAllSharesWithUsers()
    });
  });

  app.patch("/api/admin/shares/:id", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { id } = request.params as { id: string };
    const body = request.body as {
      kind?: unknown;
      customSlug?: unknown;
      passwordEnabled?: unknown;
      password?: unknown;
      regenerate?: unknown;
      expiresAt?: unknown;
    };
    const numericId = Number.parseInt(id, 10);
    if (!Number.isFinite(numericId)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const kind = body.kind === "edit" ? "edit" : body.kind === "read" ? "read" : undefined;
    const passwordEnabled = parseBooleanFlag(body.passwordEnabled);
    const customSlug = typeof body.customSlug === "string" ? body.customSlug : undefined;
    const password = typeof body.password === "string" ? body.password : undefined;
    const regenerate = parseBooleanFlag(body.regenerate);
    const expiresAt = typeof body.expiresAt === "string" ? body.expiresAt : undefined;
    if (passwordEnabled === undefined && customSlug === undefined && regenerate === undefined && expiresAt === undefined) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const existing = getShareById(numericId);
    if (!existing) {
      return reply.status(404).send({ message: "Not found" });
    }

    const updated = await updateShareById({
      id: numericId,
      kind,
      customSlug,
      passwordEnabled,
      password,
      regenerate: regenerate ?? false,
      expiresAt
    });

    logInfo("ADMIN_SHARE_UPDATED", {
      admin: request.user!.username,
      shareId: numericId,
      readSlug: updated.readSlug,
      editSlug: updated.editSlug
    });
    return reply.send({ share: updated });
  });

  app.delete("/api/admin/shares/:id", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { id } = request.params as { id: string };
    const numericId = Number.parseInt(id, 10);
    if (!Number.isFinite(numericId)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const existing = getShareById(numericId);
    if (!existing) {
      return reply.status(404).send({ message: "Not found" });
    }

    deleteShareById(numericId);
    logInfo("ADMIN_SHARE_DELETED", {
      admin: request.user!.username,
      shareId: numericId
    });
    return reply.send({ success: true });
  });

  app.get("/api/admin/users/:id/sessions", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { id } = request.params as { id: string };
    const numericId = Number.parseInt(id, 10);
    if (!Number.isFinite(numericId)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const target = getUserById(numericId);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    const sessions = listSessionsForUser(target.id).map((session) => toSessionSummary(session));
    return reply.send({
      user: {
        id: target.id,
        username: target.username,
        role: target.role
      },
      sessions
    });
  });

  app.delete("/api/admin/sessions/:id", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { id } = request.params as { id: string };
    const numericId = Number.parseInt(id, 10);
    if (!Number.isFinite(numericId)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const result = revokeAdminSession(numericId, request, reply);
    if (result.status === 404) {
      return reply.status(404).send({ message: "Not found" });
    }
    return reply.send({ success: true });
  });

  app.patch("/api/admin/notes/:username/:filename/rename", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { username, filename } = request.params as { username: string; filename: string };
    const normalizedUsername = normalizeUsername(username);
    const body = request.body as { title?: unknown };
    if (!normalizedUsername || typeof body.title !== "string") {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const target = findUserByUsername(normalizedUsername);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    const renamed = await renameNote(normalizedUsername, filename, body.title);
    renameShareFilenameForUser(target.id, filename, renamed.filename);
    await renameRevisionsForNote(normalizedUsername, filename, renamed.filename);
    logInfo("ADMIN_NOTE_RENAMED", {
      admin: request.user!.username,
      owner: normalizedUsername,
      from: filename,
      to: renamed.filename
    });
    return reply.send(renamed);
  });

  app.delete("/api/admin/notes/:username/:filename", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { username, filename } = request.params as { username: string; filename: string };
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const target = findUserByUsername(normalizedUsername);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    await deleteNote(normalizedUsername, filename);
    await clearRevisionsForNote(normalizedUsername, filename);
    deleteShareForUser(target.id, filename);
    logInfo("ADMIN_NOTE_DELETED", {
      admin: request.user!.username,
      owner: normalizedUsername,
      filename
    });
    return reply.send({ success: true });
  });

  app.get("/api/admin/notes/:username/:filename/download", async (request, reply) => {
    await requireAdmin(request, reply);
    if (reply.sent) {
      return;
    }

    const { username, filename } = request.params as { username: string; filename: string };
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const target = findUserByUsername(normalizedUsername);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    const { content } = await getDownloadPayload(normalizedUsername, filename);
    logInfo("ADMIN_NOTE_DOWNLOADED", {
      admin: request.user!.username,
      owner: normalizedUsername,
      filename,
      bytes: Buffer.byteLength(content, "utf8")
    });
    reply.header("Content-Type", "text/plain; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(content);
  });
}
