import type { FastifyInstance } from "fastify";
import { getClientIp } from "../auth.js";
import { logInfo, logWarn } from "../logger.js";
import { listNotesForUser } from "../services/notes.service.js";
import { accessPublicShare, createPublicEditGrantToken, deleteShareForUser, getShareByEditSlug, getShareForUser, hasPublicEditGrant, listSharesForUser, openPublicEdit, resolvePublicEditTarget, savePublicEdit, toShareSummary, upsertShareForUser, verifyPublicEditAccess } from "../services/shares.service.js";
import { publishNoteUpdated, subscribeToNote } from "../services/sync.service.js";
import { parseBooleanFlag } from "../services/users.service.js";
import { getPublicEditGrant } from "../utils/cookies.js";
import { openSseStream } from "../utils/sse.js";

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
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
      readEnabled?: unknown;
      editEnabled?: unknown;
      readCustomSlug?: unknown;
      editCustomSlug?: unknown;
      passwordEnabled?: unknown;
      password?: unknown;
      expiresAt?: unknown;
      regenerateRead?: unknown;
      regenerateEdit?: unknown;
    };
    const readEnabled = parseBooleanFlag(body.readEnabled);
    const editEnabled = parseBooleanFlag(body.editEnabled);
    const passwordEnabled = parseBooleanFlag(body.passwordEnabled);
    const readCustomSlug = typeof body.readCustomSlug === "string" ? body.readCustomSlug : undefined;
    const editCustomSlug = typeof body.editCustomSlug === "string" ? body.editCustomSlug : undefined;
    const password = typeof body.password === "string" ? body.password : undefined;
    const expiresAt = typeof body.expiresAt === "string" ? body.expiresAt : undefined;
    const regenerateRead = parseBooleanFlag(body.regenerateRead) ?? false;
    const regenerateEdit = parseBooleanFlag(body.regenerateEdit) ?? false;

    if (readEnabled === undefined || editEnabled === undefined || passwordEnabled === undefined) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const noteExists = (await listNotesForUser(request.user!.username, "name_asc")).some((note) => note.filename === filename);
    if (!noteExists) {
      return reply.status(404).send({ message: "Not found" });
    }

    const share = await upsertShareForUser({
      user: request.user!,
      filename,
      readEnabled,
      editEnabled,
      readCustomSlug,
      editCustomSlug,
      passwordEnabled,
      password,
      expiresAt,
      regenerateRead,
      regenerateEdit
    });

    logInfo(share ? "SHARE_UPSERTED" : "SHARE_DISABLED", {
      username: request.user!.username,
      filename,
      readSlug: share?.readSlug ?? null,
      editSlug: share?.editSlug ?? null,
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
    const result = await accessPublicShare(slug, undefined, getClientIp(request));
    return reply.send(result);
  });

  app.post("/api/public/shares/:slug/access", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : undefined;
    const result = await accessPublicShare(slug, password, getClientIp(request));
    return reply.send(result);
  });

  app.post("/api/public/edit/:slug/verify", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : undefined;
    let share;
    try {
      share = await verifyPublicEditAccess(slug, password, getClientIp(request));
    } catch (error) {
      const shareRecord = getShareByEditSlug(slug);
      if (error instanceof Error && error.message === "Invalid share password") {
        logWarn("PUBLIC_EDIT_DENIED", {
          slug,
          filename: shareRecord?.filename ?? "unknown",
          ip: getClientIp(request),
          userAgent: request.headers["user-agent"] ?? "unknown"
        });
      }
      throw error;
    }
    const grantToken = createPublicEditGrantToken(share);
    return reply.send({ success: true, grantToken });
  });

  app.get("/api/public/edit/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const share = getShareByEditSlug(slug);
    if (!share) {
      return reply.status(404).send({ message: "Not found" });
    }

    const hasAccess = !share.password_hash || hasPublicEditGrant(share, getPublicEditGrant(request));
    const result = await openPublicEdit(slug, hasAccess);
    if (!result.requiresPassword) {
      logInfo("PUBLIC_EDIT_OPENED", {
        slug,
        filename: result.filename ?? "unknown",
        ip: getClientIp(request),
        userAgent: request.headers["user-agent"] ?? "unknown"
      });
    }
    return reply.send(result);
  });

  app.put("/api/public/edit/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { content?: unknown; baseVersion?: unknown };
    const baseVersion =
      typeof body?.baseVersion === "number"
        ? body.baseVersion
        : Number.parseInt(String(body?.baseVersion ?? ""), 10);
    if (typeof body?.content !== "string" || !Number.isFinite(baseVersion)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const share = getShareByEditSlug(slug);
    if (!share) {
      logWarn("PUBLIC_EDIT_DENIED", {
        slug,
        filename: "unknown",
        ip: getClientIp(request),
        userAgent: request.headers["user-agent"] ?? "unknown"
      });
      return reply.status(404).send({ message: "Not found" });
    }

    const hasAccess = !share.password_hash || hasPublicEditGrant(share, getPublicEditGrant(request));
    if (!hasAccess) {
      logWarn("PUBLIC_EDIT_DENIED", {
        slug,
        filename: share.filename,
        ip: getClientIp(request),
        userAgent: request.headers["user-agent"] ?? "unknown"
      });
      return reply.status(403).send({ message: "Forbidden" });
    }

    const result = await savePublicEdit(slug, body.content, baseVersion);
    if (!result.ok) {
      return reply.status(409).send({
        error: "VERSION_CONFLICT",
        message: "This note was updated elsewhere.",
        serverVersion: result.serverVersion,
        serverContent: result.serverContent,
        updatedAt: result.updatedAt
      });
    }
    if (!result.changed) {
      return reply.send({ success: true, filename: result.filename, editCount: result.editCount, version: result.version, updatedAt: result.updatedAt });
    }
    logInfo("PUBLIC_EDIT_SAVED", {
      slug,
      filename: result.filename,
      ip: getClientIp(request),
      userAgent: request.headers["user-agent"] ?? "unknown"
    });
    publishNoteUpdated(result.ownerUsername, result.filename, result.version, result.updatedAt);
    return reply.send({ success: true, filename: result.filename, editCount: result.editCount, version: result.version, updatedAt: result.updatedAt });
  });

  app.get("/api/public/edit/:slug/events", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const grantToken = typeof (request.query as { grantToken?: string } | undefined)?.grantToken === "string"
      ? (request.query as { grantToken?: string }).grantToken
      : undefined;
    const target = resolvePublicEditTarget(slug, grantToken);
    if (!target) {
      return reply.status(404).send({ message: "Not found" });
    }
    if (target === "forbidden") {
      return reply.status(403).send({ message: "Forbidden" });
    }

    let unsubscribe = () => {};
    const stream = openSseStream(request, reply, () => {
      unsubscribe();
    });
    unsubscribe = subscribeToNote(target.username, target.filename, (event) => {
      stream.send(event);
    }, stream.close);
  });
}
