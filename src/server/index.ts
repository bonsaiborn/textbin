import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { cleanupExpiredSessions, clearSessionCookie, createSession, deleteSessionByToken, findUserByUsername, getAuthenticatedUser, getClientIp, getSessionCookieName, hashPassword, isLoginBlocked, recordLoginAttempt, requireAdmin, requireAuth, setSessionCookie, verifyPassword } from "./auth.js";
import { config } from "./config.js";
import { getDb, getInstanceSettings, initializeDatabase, updateInstanceSettings } from "./db.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { assertSafeUsername, createNote, deleteNote, getDownloadPayload, listNotesForUser, parseSortMode, readNote, renameNote, resolveUserNotesDir, updateNote } from "./notes.js";
import { accessPublicShare, deleteShareById, deleteShareForUser, getShareById, getShareBySlug, getShareForUser, listAllSharesWithUsers, listSharesForUser, renameShareFilenameForUser, toShareSummary, updateShareById, upsertShareForUser } from "./shares.js";
import type { InstanceSettings, UserRecord, UserRole } from "./types.js";

function isErrorWithMessage(value: unknown): value is Error {
  return value instanceof Error;
}

function isErrorWithCode(value: unknown): value is Error & { code?: string } {
  return value instanceof Error;
}

function parseRole(value: unknown): UserRole | undefined {
  return value === "admin" || value === "user" ? value : undefined;
}

function parseBooleanFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeUsername(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  assertSafeUsername(normalized);
  return normalized;
}

function hasUnsafeCrossOrigin(request: FastifyRequest): boolean {
  if (!request.raw.url?.startsWith("/api/")) {
    return false;
  }

  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return false;
  }

  if (request.raw.url.startsWith("/api/public/shares/")) {
    return false;
  }

  const origin = request.headers.origin;
  if (!origin) {
    return false;
  }

  try {
    const requestOrigin = new URL(origin);
    const appOrigin = new URL(config.appUrl);

    if (requestOrigin.origin === appOrigin.origin) {
      return false;
    }

    const localhostHosts = new Set(["localhost", "127.0.0.1"]);
    const sameLocalhostTarget =
      localhostHosts.has(requestOrigin.hostname) &&
      localhostHosts.has(appOrigin.hostname) &&
      requestOrigin.port === appOrigin.port;

    if (sameLocalhostTarget) {
      return false;
    }

    return true;
  } catch {
    return true;
  }
}

function isExplicitlyBlockedPath(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  const pathname = url.split("?")[0].toLowerCase();
  return (
    pathname === "/data" ||
    pathname.startsWith("/data/") ||
    pathname === "/notes" ||
    pathname.startsWith("/notes/") ||
    pathname.endsWith(".sqlite") ||
    pathname.endsWith(".db")
  );
}

function validateSettings(body: Record<string, unknown>): InstanceSettings {
  const defaultTheme =
    body.defaultTheme === "light"
      ? "light"
      : body.defaultTheme === "dark"
        ? "dark"
        : body.defaultTheme === "system"
          ? "system"
          : undefined;
  const shareSlugLength = typeof body.shareSlugLength === "number" ? body.shareSlugLength : Number.parseInt(String(body.shareSlugLength ?? ""), 10);
  const shareCharset = typeof body.shareCharset === "string" ? body.shareCharset : undefined;

  if (!defaultTheme || !Number.isFinite(shareSlugLength) || shareSlugLength < 4 || shareSlugLength > 64 || !shareCharset || shareCharset.length === 0 || shareCharset.length > 128) {
    throw new Error("Invalid settings");
  }

  return {
    defaultTheme,
    shareSlugLength,
    shareCharset
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let cachedSpaTemplate: string | undefined;

function getSpaTemplate(clientRoot: string): string {
  if (cachedSpaTemplate) {
    return cachedSpaTemplate;
  }

  const builtIndexPath = path.join(clientRoot, "index.html");
  if (fs.existsSync(builtIndexPath)) {
    cachedSpaTemplate = fs.readFileSync(builtIndexPath, "utf8");
    return cachedSpaTemplate;
  }

  const sourceIndexPath = path.resolve("src/client/index.html");
  cachedSpaTemplate = fs.readFileSync(sourceIndexPath, "utf8");
  return cachedSpaTemplate;
}

function renderSpaHtml(clientRoot: string, options?: { title?: string; description?: string; imageUrl?: string }): string {
  const template = getSpaTemplate(clientRoot);
  const title = escapeHtml(options?.title ?? "TextBin");
  const description = escapeHtml(options?.description ?? "Private self-hosted plain text vault.");
  const imageUrl = escapeHtml(options?.imageUrl ?? "/og/textbin-og.png");

  return template
    .replace(/<title>.*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta property="og:title" content=".*?" \/>/i, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta name="twitter:title" content=".*?" \/>/i, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="description" content=".*?" \/>/i, `<meta name="description" content="${description}" />`)
    .replace(/<meta property="og:description" content=".*?" \/>/i, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta name="twitter:description" content=".*?" \/>/i, `<meta name="twitter:description" content="${description}" />`)
    .replace(/<meta property="og:image" content=".*?" \/>/i, `<meta property="og:image" content="${imageUrl}" />`)
    .replace(/<meta name="twitter:image" content=".*?" \/>/i, `<meta name="twitter:image" content="${imageUrl}" />`);
}

async function buildUserSummary(user: UserRecord) {
  const notes = await listNotesForUser(user.username, "created_desc");
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    blocked: Boolean(user.blocked),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    noteCount: notes.length
  };
}

async function buildServer() {
  await initializeDatabase();

  const app = Fastify({
    logger: false,
    bodyLimit: config.maxNoteSize,
    trustProxy: config.trustProxy
  });

  await app.register(cookie, {
    secret: config.appSecret
  });

  app.addHook("onRequest", async (request, reply) => {
    cleanupExpiredSessions();
    reply.header("Content-Security-Policy", "default-src 'self'");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate");
    if (request.raw.url?.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
    }

    if (isExplicitlyBlockedPath(request.raw.url)) {
      return reply.status(404).send({ message: "Not found" });
    }

    const isAssetRequest =
      request.raw.url?.startsWith("/assets/") ||
      request.raw.url === "/robots.txt" ||
      request.raw.url === "/site.webmanifest" ||
      request.raw.url === "/favicon.ico" ||
      request.raw.url?.startsWith("/icons/") ||
      request.raw.url?.startsWith("/og/") ||
      request.raw.url?.startsWith("/api/auth/login") ||
      request.raw.url?.startsWith("/api/public/shares/") ||
      request.raw.url?.startsWith("/s/");

    if (request.raw.url?.startsWith("/api/") && !request.raw.url.startsWith("/api/auth/login")) {
      if (request.raw.url.startsWith("/api/public/shares/")) {
        return;
      }
      if (hasUnsafeCrossOrigin(request)) {
        logWarn("CSRF_BLOCKED", {
          method: request.method,
          url: request.url,
          origin: request.headers.origin ?? "none",
          appUrl: config.appUrl
        });
        return reply.status(403).send({ message: "Forbidden" });
      }
      await requireAuth(request, reply);
      if (reply.sent) {
        return reply;
      }
    } else if (!request.raw.url?.startsWith("/api/") && !isAssetRequest) {
      const user = getAuthenticatedUser(request);
      if (!user && request.raw.url !== "/" && request.raw.url !== "/login" && !request.raw.url?.startsWith("/s/")) {
        return reply.redirect("/login");
      }
    }

    if (request.raw.url?.startsWith("/api/auth/login") && hasUnsafeCrossOrigin(request)) {
      logWarn("CSRF_BLOCKED", {
        method: request.method,
        url: request.url,
        origin: request.headers.origin ?? "none",
        appUrl: config.appUrl
      });
      return reply.status(403).send({ message: "Forbidden" });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { username?: unknown; password?: unknown };
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const ip = getClientIp(request);

    if (!username || !password || isLoginBlocked(username, ip)) {
      logWarn("BLOCKED_LOGIN", {
        username: username || "unknown",
        ip
      });
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    const user = findUserByUsername(username);
    const isValid = user ? await verifyPassword(user.password_hash, password) : false;

    if (user?.blocked) {
      recordLoginAttempt(username, ip, false);
      logWarn("BLOCKED_LOGIN", {
        username,
        ip
      });
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    recordLoginAttempt(username, ip, isValid);

    if (!user || !isValid) {
      logWarn("FAILED_LOGIN", {
        username,
        ip
      });
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    const token = createSession(user.id);
    setSessionCookie(reply, token);
    logInfo("LOGIN", {
      username: user.username,
      ip,
      role: user.role
    });
    return reply.send({ user: { username: user.username, role: user.role } });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[getSessionCookieName()];
    const user = getAuthenticatedUser(request);
    if (token) {
      deleteSessionByToken(token);
    }
    clearSessionCookie(reply);
    logInfo("LOGOUT", {
      username: user?.username ?? "unknown",
      ip: getClientIp(request)
    });
    return reply.send({ success: true });
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = getAuthenticatedUser(request);
    if (!user) {
      return reply.status(401).send({ message: "Unauthorized" });
    }
    return reply.send({ user: { username: user.username, role: user.role } });
  });

  app.get("/api/settings", async (_request, reply) => {
    return reply.send({ settings: getInstanceSettings() });
  });

  app.get("/api/notes", async (request) => {
    const sort = parseSortMode((request.query as { sort?: string }).sort);
    return { notes: await listNotesForUser(request.user!.username, sort) };
  });

  app.post("/api/notes", async (request, reply) => {
    const body = request.body as { title?: unknown; content?: unknown };
    if (typeof body?.title !== "string" || typeof body?.content !== "string") {
      return reply.status(400).send({ message: "Invalid request body" });
    }
    const note = await createNote(request.user!.username, body.title, body.content);
    logInfo("NOTE_CREATED", {
      username: request.user?.username ?? "unknown",
      filename: note.filename,
      bytes: Buffer.byteLength(body.content, "utf8")
    });
    return reply.status(201).send(note);
  });

  app.get("/api/notes/:filename", async (request) => {
    const { filename } = request.params as { filename: string };
    return readNote(request.user!.username, filename);
  });

  app.put("/api/notes/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const body = request.body as { content?: unknown };
    if (typeof body?.content !== "string") {
      return reply.status(400).send({ message: "Invalid request body" });
    }
    await updateNote(request.user!.username, filename, body.content);
    logInfo("NOTE_UPDATED", {
      username: request.user?.username ?? "unknown",
      filename,
      bytes: Buffer.byteLength(body.content, "utf8")
    });
    return reply.send({ success: true });
  });

  app.patch("/api/notes/:filename/rename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const body = request.body as { title?: unknown };
    if (typeof body?.title !== "string") {
      return reply.status(400).send({ message: "Invalid request body" });
    }
    const renamed = await renameNote(request.user!.username, filename, body.title);
    renameShareFilenameForUser(request.user!.id, filename, renamed.filename);
    logInfo("NOTE_RENAMED", {
      username: request.user?.username ?? "unknown",
      from: filename,
      to: renamed.filename
    });
    return reply.send(renamed);
  });

  app.delete("/api/notes/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    await deleteNote(request.user!.username, filename);
    deleteShareForUser(request.user!.id, filename);
    logInfo("NOTE_DELETED", {
      username: request.user?.username ?? "unknown",
      filename
    });
    return reply.send({ success: true });
  });

  app.get("/api/notes/:filename/download", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const { content } = await getDownloadPayload(request.user!.username, filename);
    logInfo("NOTE_DOWNLOADED", {
      username: request.user?.username ?? "unknown",
      filename,
      bytes: Buffer.byteLength(content, "utf8")
    });
    reply.header("Content-Type", "text/plain; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(content);
  });

  app.get("/api/shares", async (request, reply) => {
    return reply.send({
      shares: listSharesForUser(request.user!.id)
    });
  });

  app.get("/api/shares/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const share = getShareForUser(request.user!.id, filename);
    return reply.send({
      share: share ? toShareSummary(share) : null
    });
  });

  app.put("/api/shares/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const body = request.body as {
      enabled?: unknown;
      customSlug?: unknown;
      passwordEnabled?: unknown;
      password?: unknown;
    };
    const enabled = parseBooleanFlag(body.enabled);
    const passwordEnabled = parseBooleanFlag(body.passwordEnabled);
    const customSlug = typeof body.customSlug === "string" ? body.customSlug : undefined;
    const password = typeof body.password === "string" ? body.password : undefined;

    if (enabled === undefined || passwordEnabled === undefined) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const noteExists = (await listNotesForUser(request.user!.username, "name_asc")).some((note) => note.filename === filename);
    if (!noteExists) {
      return reply.status(404).send({ message: "Not found" });
    }

    const share = await upsertShareForUser({
      user: request.user!,
      filename,
      enabled,
      customSlug,
      passwordEnabled,
      password
    });

    logInfo(share ? "SHARE_UPSERTED" : "SHARE_DISABLED", {
      username: request.user!.username,
      filename,
      slug: share?.slug ?? null,
      password: share?.hasPassword ?? false
    });

    return reply.send({ share });
  });

  app.delete("/api/shares/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    deleteShareForUser(request.user!.id, filename);
    logInfo("SHARE_DELETED", {
      username: request.user!.username,
      filename
    });
    return reply.send({ success: true });
  });

  app.get("/api/public/shares/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const result = await accessPublicShare(slug);
    return reply.send(result);
  });

  app.post("/api/public/shares/:slug/access", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : undefined;
    const result = await accessPublicShare(slug, password);
    return reply.send(result);
  });

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

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const result = getDb().prepare(
      `INSERT INTO users (username, password_hash, role, blocked, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`
    ).run(username, passwordHash, role, now, now);
    const created = getDb().prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as UserRecord;

    logInfo("USER_CREATED", {
      admin: request.user!.username,
      username,
      role
    });

    return reply.status(201).send({
      user: await buildUserSummary(created)
    });
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

    const target = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    const passwordHash = await hashPassword(password);
    getDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, new Date().toISOString(), id);
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

    const target = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    if (target.id === request.user!.id && role !== "admin") {
      return reply.status(400).send({ message: "Cannot demote current admin session" });
    }

    getDb().prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, new Date().toISOString(), id);
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

    const target = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    if (target.id === request.user!.id && blocked) {
      return reply.status(400).send({ message: "Cannot block current admin session" });
    }

    getDb().prepare("UPDATE users SET blocked = ?, updated_at = ? WHERE id = ?").run(blocked ? 1 : 0, new Date().toISOString(), id);
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
    const target = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }

    if (target.id === request.user!.id) {
      return reply.status(400).send({ message: "Cannot delete current admin session" });
    }

    getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
    fs.rmSync(resolveUserNotesDir(target.username), { recursive: true, force: true });
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
      shareSlugLength: updated.shareSlugLength
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
      customSlug?: unknown;
      passwordEnabled?: unknown;
      password?: unknown;
    };
    const numericId = Number.parseInt(id, 10);
    if (!Number.isFinite(numericId)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const passwordEnabled = parseBooleanFlag(body.passwordEnabled);
    const customSlug = typeof body.customSlug === "string" ? body.customSlug : undefined;
    const password = typeof body.password === "string" ? body.password : undefined;
    if (passwordEnabled === undefined && customSlug === undefined) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const existing = getShareById(numericId);
    if (!existing) {
      return reply.status(404).send({ message: "Not found" });
    }

    const updated = await updateShareById({
      id: numericId,
      customSlug,
      passwordEnabled,
      password
    });

    logInfo("ADMIN_SHARE_UPDATED", {
      admin: request.user!.username,
      shareId: numericId,
      slug: updated.slug
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


  app.setErrorHandler((error, request, reply) => {
    const message = isErrorWithMessage(error) ? error.message : "Internal server error";
    const isValidationLike =
      message === "Invalid filename" ||
      message === "Invalid username" ||
      message === "Invalid settings" ||
      message === "Invalid share slug" ||
      message === "Share password is required" ||
      message === "Could not generate unique share slug" ||
      message === "Share slug already exists" ||
      message === "RESET_ADMIN_ON_START username conflicts with an existing user" ||
      message === "Note exceeds maximum size";
    const notFound = isErrorWithCode(error) && error.code === "ENOENT";
    const notFoundByMessage = message === "Share not found";
    const authByMessage = message === "Invalid share password";
    const statusCode = authByMessage ? 401 : notFound || notFoundByMessage ? 404 : isValidationLike ? 400 : 500;

    logError("REQUEST_ERROR", {
      method: request.method,
      url: request.url,
      username: request.user?.username ?? "unknown",
      status: statusCode,
      message
    });

    reply.status(statusCode).send({
      message: notFound ? "Not found" : authByMessage ? "Invalid password" : isValidationLike ? message : "Internal server error"
    });
  });

  const clientRoot = path.resolve("dist/client");
  if (fs.existsSync(clientRoot)) {
    await app.register(fastifyStatic, {
      root: clientRoot,
      prefix: "/"
    });

    app.get("/site.webmanifest", async (_request, reply) => {
      reply.type("application/manifest+json; charset=utf-8");
      return reply.sendFile("site.webmanifest");
    });
    app.get("/robots.txt", async (_request, reply) => {
      reply.type("text/plain; charset=utf-8");
      return reply.sendFile("robots.txt");
    });
    app.get("/favicon.ico", async (_request, reply) => {
      return reply.sendFile("icons/favicon-32.png");
    });
    app.get("/icons/:file", async (request, reply) => {
      const { file } = request.params as { file: string };
      return reply.sendFile(`icons/${file}`);
    });
    app.get("/og/:file", async (request, reply) => {
      const { file } = request.params as { file: string };
      return reply.sendFile(`og/${file}`);
    });
    app.get("/login", async (_request, reply) => reply.type("text/html; charset=utf-8").send(renderSpaHtml(clientRoot)));
    app.get("/dashboard", async (_request, reply) => reply.type("text/html; charset=utf-8").send(renderSpaHtml(clientRoot)));
    app.get("/s/:slug", async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const share = getShareBySlug(slug);
      const title = share?.password_hash
        ? "Protected TextBin Note"
        : share?.filename.replace(/\.txt$/i, "") || "Shared Note";
      const description = share?.password_hash
        ? "Password-protected shared note from TextBin."
        : `Public shared note: ${title}`;
      return reply
        .type("text/html; charset=utf-8")
        .send(renderSpaHtml(clientRoot, { title, description }));
    });
    app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(renderSpaHtml(clientRoot)));
    app.setNotFoundHandler(async (request, reply) => {
      if (!request.raw.url?.startsWith("/api/")) {
        return reply.type("text/html; charset=utf-8").send(renderSpaHtml(clientRoot));
      }
      return reply.status(404).send({ message: "Not found" });
    });
  }

  return app;
}

const app = await buildServer();

app.listen({ host: "0.0.0.0", port: config.port }).catch((error) => {
  logError("SERVER_START_FAILED", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

logInfo("SERVER_STARTED", {
  port: config.port,
  appUrl: config.appUrl,
  trustProxy: config.trustProxy
});
