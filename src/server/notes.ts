import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { deleteNoteMetadata, getOrCreateNoteMetadata, renameNoteMetadata, updateNoteMetadataVersion } from "./db.js";
import type { NoteMeta, SortMode } from "./types.js";
export { assertSafeFilename, assertSafeUsername, sanitizeTitleToFilename } from "./utils/filenames-core.js";
import { assertSafeFilename, assertSafeUsername, sanitizeTitleToFilename } from "./utils/filenames-core.js";
interface NoteMetaWithSortValues extends NoteMeta {
  createdMs: number;
  updatedMs: number;
}

const noteSaveLocks = new Map<string, Promise<void>>();

async function withNoteSaveLock<T>(username: string, filename: string, fn: () => Promise<T>): Promise<T> {
  const key = `${username}:${filename}`;
  const previous = noteSaveLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => next);
  noteSaveLocks.set(key, current);
  await previous;

  try {
    return await fn();
  } finally {
    release();
    if (noteSaveLocks.get(key) === current) {
      noteSaveLocks.delete(key);
    }
  }
}

export function resolveUserNotesDir(username: string): string {
  assertSafeUsername(username);
  const resolved = path.resolve(config.notesDir, username);
  const relative = path.relative(config.notesDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid username");
  }
  return resolved;
}

export function resolveNotePath(username: string, filename: string): string {
  assertSafeFilename(filename);
  const resolved = path.resolve(resolveUserNotesDir(username), filename);

  const relative = path.relative(resolveUserNotesDir(username), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid filename");
  }

  return resolved;
}

async function ensureUserNotesDir(username: string): Promise<void> {
  await fs.mkdir(resolveUserNotesDir(username), { recursive: true });
}

async function getUniqueFilename(username: string, baseFilename: string): Promise<string> {
  const extension = ".txt";
  const stem = baseFilename.slice(0, -extension.length);
  let candidate = baseFilename;
  let counter = 2;

  while (true) {
    try {
      await fs.access(resolveNotePath(username, candidate));
      candidate = `${stem}-${counter}${extension}`;
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

function toDisplayName(filename: string): string {
  return filename.replace(/\.txt$/i, "");
}

async function statToMeta(username: string, filename: string): Promise<NoteMetaWithSortValues> {
  const fullPath = resolveNotePath(username, filename);
  const stats = await fs.stat(fullPath);
  const createdMs = Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
    ? stats.birthtimeMs
    : stats.mtimeMs;
  const updatedMs = stats.mtimeMs;
  const metadata = getOrCreateNoteMetadata(username, filename, new Date(createdMs).toISOString(), new Date(updatedMs).toISOString());

  return {
    filename,
    displayName: toDisplayName(filename),
    sizeBytes: stats.size,
    createdAt: new Date(createdMs).toISOString(),
    updatedAt: new Date(updatedMs).toISOString(),
    version: metadata.version,
    createdMs,
    updatedMs
  };
}

export async function listNotesForUser(username: string, sort: SortMode): Promise<NoteMeta[]> {
  await ensureUserNotesDir(username);
  const entries = await fs.readdir(resolveUserNotesDir(username), { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => entry.name);

  const notes = await Promise.all(filenames.map((filename) => statToMeta(username, filename)));

  notes.sort((left, right) => {
    switch (sort) {
      case "created_asc":
        return left.updatedMs - right.updatedMs || left.filename.localeCompare(right.filename);
      case "name_asc":
        return left.filename.localeCompare(right.filename);
      case "name_desc":
        return right.filename.localeCompare(left.filename);
      case "created_desc":
      default:
        return right.updatedMs - left.updatedMs || right.filename.localeCompare(left.filename);
    }
  });

  return notes.map(({ createdMs: _createdMs, updatedMs: _updatedMs, ...note }) => note);
}

export async function createNote(username: string, title: string, content: string): Promise<NoteMeta> {
  enforceNoteSize(content);
  await ensureUserNotesDir(username);
  const filename = await getUniqueFilename(username, sanitizeTitleToFilename(title));
  const fullPath = resolveNotePath(username, filename);
  await fs.writeFile(fullPath, content, "utf8");
  return statToMeta(username, filename);
}

export async function readNote(username: string, filename: string): Promise<{ filename: string; content: string; version: number; updatedAt: string }> {
  const fullPath = resolveNotePath(username, filename);
  const content = await fs.readFile(fullPath, "utf8");
  const meta = await statToMeta(username, filename);
  return { filename, content, version: meta.version, updatedAt: meta.updatedAt };
}

export async function updateNote(username: string, filename: string, content: string): Promise<void> {
  enforceNoteSize(content);
  await fs.writeFile(resolveNotePath(username, filename), content, "utf8");
}

export async function saveNoteWithVersion(
  username: string,
  filename: string,
  content: string,
  baseVersion: number,
  options?: { beforeWrite?: () => Promise<void> | void }
): Promise<
  | { ok: true; version: number; updatedAt: string; changed: boolean }
  | { ok: false; serverVersion: number; serverContent: string; updatedAt: string }
> {
  enforceNoteSize(content);
  return withNoteSaveLock(username, filename, async () => {
    const current = await readNote(username, filename);
    if (current.version !== baseVersion) {
      return {
        ok: false,
        serverVersion: current.version,
        serverContent: current.content,
        updatedAt: current.updatedAt
      };
    }

    if (current.content === content) {
      return {
        ok: true,
        version: current.version,
        updatedAt: current.updatedAt,
        changed: false
      };
    }

    await options?.beforeWrite?.();
    await fs.writeFile(resolveNotePath(username, filename), content, "utf8");
    const updatedAt = new Date().toISOString();
    const version = updateNoteMetadataVersion(username, filename, current.version + 1, updatedAt);
    return { ok: true, version, updatedAt, changed: true };
  });
}

export async function renameNote(username: string, filename: string, title: string): Promise<NoteMeta> {
  const nextFilename = await getUniqueFilename(username, sanitizeTitleToFilename(title));
  if (nextFilename === filename) {
    return statToMeta(username, filename);
  }
  await fs.rename(resolveNotePath(username, filename), resolveNotePath(username, nextFilename));
  renameNoteMetadata(username, filename, nextFilename);
  return statToMeta(username, nextFilename);
}

export async function deleteNote(username: string, filename: string): Promise<void> {
  await fs.unlink(resolveNotePath(username, filename));
  deleteNoteMetadata(username, filename);
}

export async function getDownloadPayload(username: string, filename: string): Promise<{ content: string; path: string }> {
  const fullPath = resolveNotePath(username, filename);
  const content = await fs.readFile(fullPath, "utf8");
  return { content, path: fullPath };
}

export function parseSortMode(value: unknown): SortMode {
  if (value === "created_asc" || value === "name_asc" || value === "name_desc") {
    return value;
  }
  return "created_desc";
}

export function enforceNoteSize(content: string): void {
  const size = Buffer.byteLength(content, "utf8");
  if (size > config.maxNoteSize) {
    throw new Error("Note exceeds maximum size");
  }
}
