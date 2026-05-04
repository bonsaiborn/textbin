import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { NoteMeta, SortMode } from "./types.js";

const FILENAME_RE = /^[a-z0-9_-]+\.txt$/;
const USERNAME_RE = /^[a-z0-9_-]{3,64}$/;
interface NoteMetaWithSortValues extends NoteMeta {
  createdMs: number;
  updatedMs: number;
}

export function sanitizeTitleToFilename(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");

  const base = normalized || "untitled";
  return `${base}.txt`;
}

export function assertSafeFilename(filename: string): void {
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("..") ||
    !FILENAME_RE.test(filename)
  ) {
    throw new Error("Invalid filename");
  }
}

export function assertSafeUsername(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new Error("Invalid username");
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

  return {
    filename,
    displayName: toDisplayName(filename),
    sizeBytes: stats.size,
    createdAt: new Date(createdMs).toISOString(),
    updatedAt: new Date(updatedMs).toISOString(),
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
        return left.createdMs - right.createdMs || left.filename.localeCompare(right.filename);
      case "name_asc":
        return left.filename.localeCompare(right.filename);
      case "name_desc":
        return right.filename.localeCompare(left.filename);
      case "created_desc":
      default:
        return right.createdMs - left.createdMs || right.filename.localeCompare(left.filename);
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

export async function readNote(username: string, filename: string): Promise<{ filename: string; content: string }> {
  const fullPath = resolveNotePath(username, filename);
  const content = await fs.readFile(fullPath, "utf8");
  return { filename, content };
}

export async function updateNote(username: string, filename: string, content: string): Promise<void> {
  enforceNoteSize(content);
  await fs.writeFile(resolveNotePath(username, filename), content, "utf8");
}

export async function renameNote(username: string, filename: string, title: string): Promise<NoteMeta> {
  const nextFilename = await getUniqueFilename(username, sanitizeTitleToFilename(title));
  if (nextFilename === filename) {
    return statToMeta(username, filename);
  }
  await fs.rename(resolveNotePath(username, filename), resolveNotePath(username, nextFilename));
  return statToMeta(username, nextFilename);
}

export async function deleteNote(username: string, filename: string): Promise<void> {
  await fs.unlink(resolveNotePath(username, filename));
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
