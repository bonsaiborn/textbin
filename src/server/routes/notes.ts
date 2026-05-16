import type { FastifyInstance } from "fastify";
import { logInfo } from "../logger.js";
import { createNote, deleteNote, getDownloadPayload, listNotesForUser, parseSortMode, readNote, renameNote, saveNoteWithVersion } from "../services/notes.service.js";
import { clearRevisionsForNote, createRevisionSnapshot, listRevisionsForNote, readRevisionForNote, renameRevisionsForNote, restoreRevisionForNote } from "../services/revisions.service.js";
import { deleteShareForUser, renameShareFilenameForUser } from "../services/shares.service.js";
import { publishNoteUpdated, subscribeToNote } from "../services/sync.service.js";
import { openSseStream } from "../utils/sse.js";

export async function registerNotesRoutes(app: FastifyInstance): Promise<void> {
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

  app.get("/api/notes/:filename/revisions", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    await readNote(request.user!.username, filename);
    return reply.send({
      revisions: listRevisionsForNote(request.user!.username, filename)
    });
  });

  app.get("/api/notes/:filename/revisions/:revisionId", async (request, reply) => {
    const { filename, revisionId } = request.params as { filename: string; revisionId: string };
    await readNote(request.user!.username, filename);
    const numericRevisionId = Number.parseInt(revisionId, 10);
    if (!Number.isFinite(numericRevisionId)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const revision = await readRevisionForNote(request.user!.username, filename, numericRevisionId);
    return reply.send(revision);
  });

  app.post("/api/notes/:filename/revisions/:revisionId/restore", async (request, reply) => {
    const { filename, revisionId } = request.params as { filename: string; revisionId: string };
    const body = request.body as { baseVersion?: unknown };
    const baseVersion =
      typeof body?.baseVersion === "number"
        ? body.baseVersion
        : Number.parseInt(String(body?.baseVersion ?? ""), 10);
    const numericRevisionId = Number.parseInt(revisionId, 10);
    if (!Number.isFinite(baseVersion) || !Number.isFinite(numericRevisionId)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }

    const result = await restoreRevisionForNote(request.user!.username, filename, numericRevisionId, baseVersion);
    if (!result.ok) {
      return reply.status(409).send({
        error: "VERSION_CONFLICT",
        message: "This note was updated elsewhere.",
        serverVersion: result.serverVersion,
        serverContent: result.serverContent,
        updatedAt: result.updatedAt
      });
    }

    logInfo("NOTE_REVISION_RESTORED", {
      username: request.user?.username ?? "unknown",
      filename,
      revisionId: numericRevisionId,
      version: result.version
    });
    publishNoteUpdated(request.user!.username, filename, result.version, result.updatedAt);
    return reply.send({
      success: true,
      version: result.version,
      updatedAt: result.updatedAt,
      content: result.content
    });
  });

  app.delete("/api/notes/:filename/revisions", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    await readNote(request.user!.username, filename);
    await clearRevisionsForNote(request.user!.username, filename);
    logInfo("NOTE_REVISIONS_CLEARED", {
      username: request.user?.username ?? "unknown",
      filename
    });
    return reply.send({ success: true });
  });

  app.put("/api/notes/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const body = request.body as { content?: unknown; baseVersion?: unknown };
    const baseVersion =
      typeof body?.baseVersion === "number"
        ? body.baseVersion
        : Number.parseInt(String(body?.baseVersion ?? ""), 10);
    if (typeof body?.content !== "string" || !Number.isFinite(baseVersion)) {
      return reply.status(400).send({ message: "Invalid request body" });
    }
    const current = await readNote(request.user!.username, filename);
    const result = await saveNoteWithVersion(request.user!.username, filename, body.content, baseVersion, {
      beforeWrite: () => createRevisionSnapshot(request.user!.username, filename, current.version, current.content)
    });
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
      return reply.send({ success: true, version: result.version, updatedAt: result.updatedAt });
    }
    logInfo("NOTE_UPDATED", {
      username: request.user?.username ?? "unknown",
      filename,
      bytes: Buffer.byteLength(body.content, "utf8")
    });
    publishNoteUpdated(request.user!.username, filename, result.version, result.updatedAt);
    return reply.send({ success: true, version: result.version, updatedAt: result.updatedAt });
  });

  app.get("/api/notes/:filename/events", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    await readNote(request.user!.username, filename);
    let unsubscribe = () => {};
    const stream = openSseStream(request, reply, () => {
      unsubscribe();
    });
    unsubscribe = subscribeToNote(request.user!.username, filename, (event) => {
      stream.send(event);
    }, stream.close);
  });

  app.patch("/api/notes/:filename/rename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const body = request.body as { title?: unknown };
    if (typeof body?.title !== "string") {
      return reply.status(400).send({ message: "Invalid request body" });
    }
    const renamed = await renameNote(request.user!.username, filename, body.title);
    renameShareFilenameForUser(request.user!.id, filename, renamed.filename);
    await renameRevisionsForNote(request.user!.username, filename, renamed.filename);
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
    await clearRevisionsForNote(request.user!.username, filename);
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
}
