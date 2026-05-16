import fs from "node:fs/promises";
import path from "node:path";
import { getDb, getInstanceSettings } from "../db.js";
import { readNote, resolveUserNotesDir, saveNoteWithVersion } from "../notes.js";
import type { NoteRevisionRecord } from "../types.js";
import { assertSafeFilename, assertSafeUsername } from "../utils/filenames-core.js";

export interface NoteRevisionSummary {
  id: number;
  version: number;
  sizeBytes: number;
  createdAt: string;
}

export interface NoteRevisionDetail extends NoteRevisionSummary {
  content: string;
}

function getRevisionRootDir(username: string): string {
  assertSafeUsername(username);
  return path.join(resolveUserNotesDir(username), ".revision");
}

function getRevisionNoteDir(username: string, filename: string): string {
  assertSafeFilename(filename);
  return path.join(getRevisionRootDir(username), filename);
}

function getRelativeRevisionPath(filename: string, version: number): string {
  assertSafeFilename(filename);
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error("Invalid revision version");
  }
  return path.posix.join(".revision", filename, `${version}.txt`);
}

function resolveRevisionPath(username: string, relativeRevisionPath: string): string {
  const notesDir = resolveUserNotesDir(username);
  const resolved = path.resolve(notesDir, relativeRevisionPath);
  const relative = path.relative(notesDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid revision path");
  }
  return resolved;
}

function toSummary(record: NoteRevisionRecord): NoteRevisionSummary {
  return {
    id: record.id,
    version: record.note_version,
    sizeBytes: record.size_bytes,
    createdAt: record.created_at
  };
}

function getRevisionRecord(username: string, filename: string, revisionId: number): NoteRevisionRecord | undefined {
  return getDb()
    .prepare(
      `SELECT *
       FROM note_revisions
       WHERE id = ?
         AND username = ?
         AND filename = ?`
    )
    .get(revisionId, username, filename) as NoteRevisionRecord | undefined;
}

async function ensureRevisionNoteDir(username: string, filename: string): Promise<void> {
  await fs.mkdir(getRevisionNoteDir(username, filename), { recursive: true });
}

async function removeEmptyRevisionDirs(username: string, filename?: string): Promise<void> {
  const dirs = filename ? [getRevisionNoteDir(username, filename), getRevisionRootDir(username)] : [getRevisionRootDir(username)];
  for (const dir of dirs) {
    try {
      await fs.rmdir(dir);
    } catch {
      // Ignore non-empty, missing, or legacy content. We intentionally do not
      // remove unknown files created by older accidental .bak behavior.
    }
  }
}

async function deleteRevisionRecordFile(username: string, record: NoteRevisionRecord): Promise<void> {
  try {
    await fs.unlink(resolveRevisionPath(username, record.revision_path));
  } catch {
    // Missing files should not block metadata cleanup.
  }
}

export async function createRevisionSnapshot(
  username: string,
  filename: string,
  noteVersion: number,
  content: string
): Promise<void> {
  assertSafeUsername(username);
  assertSafeFilename(filename);

  const maxSaved = getInstanceSettings().maxNoteRevisions;
  if (maxSaved <= 0) {
    return;
  }

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id
       FROM note_revisions
       WHERE username = ?
         AND filename = ?
         AND note_version = ?`
    )
    .get(username, filename, noteVersion) as { id: number } | undefined;
  if (existing) {
    return;
  }

  const relativeRevisionPath = getRelativeRevisionPath(filename, noteVersion);
  const absoluteRevisionPath = resolveRevisionPath(username, relativeRevisionPath);
  await ensureRevisionNoteDir(username, filename);
  await fs.writeFile(absoluteRevisionPath, content, "utf8");

  db.prepare(
    `INSERT INTO note_revisions (username, filename, note_version, revision_path, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    username,
    filename,
    noteVersion,
    relativeRevisionPath,
    Buffer.byteLength(content, "utf8"),
    new Date().toISOString()
  );

  await pruneRevisionsForNote(username, filename);
}

export function listRevisionsForNote(username: string, filename: string): NoteRevisionSummary[] {
  assertSafeUsername(username);
  assertSafeFilename(filename);

  const rows = getDb()
    .prepare(
      `SELECT *
       FROM note_revisions
       WHERE username = ?
         AND filename = ?
       ORDER BY note_version DESC, created_at DESC`
    )
    .all(username, filename) as NoteRevisionRecord[];

  return rows.map(toSummary);
}

export async function readRevisionForNote(username: string, filename: string, revisionId: number): Promise<NoteRevisionDetail> {
  assertSafeUsername(username);
  assertSafeFilename(filename);

  const record = getRevisionRecord(username, filename, revisionId);
  if (!record) {
    throw new Error("Revision not found");
  }

  const content = await fs.readFile(resolveRevisionPath(username, record.revision_path), "utf8");
  return {
    ...toSummary(record),
    content
  };
}

export async function clearRevisionsForNote(username: string, filename: string): Promise<void> {
  assertSafeUsername(username);
  assertSafeFilename(filename);

  const records = getDb()
    .prepare(
      `SELECT *
       FROM note_revisions
       WHERE username = ?
         AND filename = ?`
    )
    .all(username, filename) as NoteRevisionRecord[];

  for (const record of records) {
    await deleteRevisionRecordFile(username, record);
  }

  getDb()
    .prepare(
      `DELETE FROM note_revisions
       WHERE username = ?
         AND filename = ?`
    )
    .run(username, filename);

  await removeEmptyRevisionDirs(username, filename);
}

export async function pruneRevisionsForNote(username: string, filename: string): Promise<void> {
  assertSafeUsername(username);
  assertSafeFilename(filename);

  const maxSaved = getInstanceSettings().maxNoteRevisions;
  if (maxSaved < 0) {
    return;
  }

  const records = getDb()
    .prepare(
      `SELECT *
       FROM note_revisions
       WHERE username = ?
         AND filename = ?
       ORDER BY note_version DESC, created_at DESC`
    )
    .all(username, filename) as NoteRevisionRecord[];

  const staleRecords = maxSaved === 0 ? records : records.slice(maxSaved);
  if (staleRecords.length === 0) {
    return;
  }

  const deleteStatement = getDb().prepare("DELETE FROM note_revisions WHERE id = ?");
  for (const record of staleRecords) {
    await deleteRevisionRecordFile(username, record);
    deleteStatement.run(record.id);
  }

  await removeEmptyRevisionDirs(username, filename);
}

export async function renameRevisionsForNote(username: string, oldFilename: string, newFilename: string): Promise<void> {
  assertSafeUsername(username);
  assertSafeFilename(oldFilename);
  assertSafeFilename(newFilename);
  if (oldFilename === newFilename) {
    return;
  }

  const records = getDb()
    .prepare(
      `SELECT *
       FROM note_revisions
       WHERE username = ?
         AND filename = ?`
    )
    .all(username, oldFilename) as NoteRevisionRecord[];

  if (records.length === 0) {
    return;
  }

  const oldDir = getRevisionNoteDir(username, oldFilename);
  const newDir = getRevisionNoteDir(username, newFilename);
  await fs.mkdir(getRevisionRootDir(username), { recursive: true });
  try {
    await fs.rename(oldDir, newDir);
  } catch {
    await fs.mkdir(newDir, { recursive: true });
    for (const record of records) {
      const oldPath = resolveRevisionPath(username, record.revision_path);
      const nextRelativePath = getRelativeRevisionPath(newFilename, record.note_version);
      const nextPath = resolveRevisionPath(username, nextRelativePath);
      try {
        await fs.rename(oldPath, nextPath);
      } catch {
        // Ignore legacy missing files while still migrating tracked metadata.
      }
    }
    await removeEmptyRevisionDirs(username, oldFilename);
  }

  const statement = getDb().prepare(
    `UPDATE note_revisions
     SET filename = ?, revision_path = ?
     WHERE id = ?`
  );
  for (const record of records) {
    statement.run(newFilename, getRelativeRevisionPath(newFilename, record.note_version), record.id);
  }
}

export async function restoreRevisionForNote(
  username: string,
  filename: string,
  revisionId: number,
  baseVersion: number
): Promise<
  | { ok: true; version: number; updatedAt: string; content: string }
  | { ok: false; serverVersion: number; serverContent: string; updatedAt: string }
> {
  assertSafeUsername(username);
  assertSafeFilename(filename);

  const revision = await readRevisionForNote(username, filename, revisionId);
  const current = await readNote(username, filename);
  if (current.version !== baseVersion) {
    return {
      ok: false,
      serverVersion: current.version,
      serverContent: current.content,
      updatedAt: current.updatedAt
    };
  }
  if (current.content === revision.content) {
    return {
      ok: true,
      version: current.version,
      updatedAt: current.updatedAt,
      content: current.content
    };
  }

  const result = await saveNoteWithVersion(username, filename, revision.content, baseVersion, {
    beforeWrite: () => createRevisionSnapshot(username, filename, current.version, current.content)
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    version: result.version,
    updatedAt: result.updatedAt,
    content: revision.content
  };
}
