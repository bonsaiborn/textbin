import crypto from "node:crypto";
import { verify as argonVerify } from "@node-rs/argon2";
import { defaultInstanceSettings } from "./config.js";
import { getDb, getInstanceSettings } from "./db.js";
import { hashPassword } from "./auth.js";
import { readNote } from "./notes.js";
import type { ShareRecord, ShareSummary, UserRecord } from "./types.js";

const MIN_SLUG_LENGTH = 4;
const MAX_SLUG_LENGTH = 64;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSharePattern(charset: string): RegExp {
  return new RegExp(`^[${escapeRegExp(charset)}]{${MIN_SLUG_LENGTH},${MAX_SLUG_LENGTH}}$`);
}

export function toShareSummary(record: ShareRecord): ShareSummary {
  return {
    filename: record.filename,
    slug: record.slug,
    urlPath: `/s/${record.slug}`,
    hasPassword: Boolean(record.password_hash),
    viewCount: record.view_count,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

export function getShareForUser(userId: number, filename: string): ShareRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM shares WHERE user_id = ? AND filename = ?")
    .get(userId, filename) as ShareRecord | undefined;
}

export function listSharesForUser(userId: number): ShareSummary[] {
  const rows = getDb()
    .prepare("SELECT * FROM shares WHERE user_id = ? ORDER BY updated_at DESC, id DESC")
    .all(userId) as ShareRecord[];
  return rows.map(toShareSummary);
}

export function getShareBySlug(slug: string): ShareRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM shares WHERE slug = ?")
    .get(slug) as ShareRecord | undefined;
}

export function getShareById(id: number): ShareRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM shares WHERE id = ?")
    .get(id) as ShareRecord | undefined;
}

export function listAllSharesWithUsers(): Array<ShareSummary & { id: number; username: string }> {
  const rows = getDb()
    .prepare(
      `SELECT shares.*, users.username
       FROM shares
       INNER JOIN users ON users.id = shares.user_id
       ORDER BY shares.updated_at DESC, shares.id DESC`
    )
    .all() as Array<ShareRecord & { username: string }>;

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    ...toShareSummary(row)
  }));
}

export function validateCustomSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  const settings = getInstanceSettings();
  const charset = settings.shareCharset || defaultInstanceSettings.shareCharset;
  const pattern = getSharePattern(charset);

  if (!pattern.test(normalized)) {
    throw new Error("Invalid share slug");
  }

  return normalized;
}

function generateSlug(length: number, charset: string): string {
  const bytes = crypto.randomBytes(length);
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += charset[bytes[i] % charset.length];
  }
  return output;
}

async function generateUniqueSlug(): Promise<string> {
  const settings = getInstanceSettings();
  const length = Math.min(MAX_SLUG_LENGTH, Math.max(MIN_SLUG_LENGTH, settings.shareSlugLength));
  const charset = settings.shareCharset || defaultInstanceSettings.shareCharset;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = generateSlug(length, charset);
    const existing = getShareBySlug(slug);
    if (!existing) {
      return slug;
    }
  }

  throw new Error("Could not generate unique share slug");
}

export async function upsertShareForUser(options: {
  user: Pick<UserRecord, "id" | "username">;
  filename: string;
  enabled: boolean;
  customSlug?: string;
  passwordEnabled?: boolean;
  password?: string;
}): Promise<ShareSummary | null> {
  const db = getDb();
  const existing = getShareForUser(options.user.id, options.filename);

  if (!options.enabled) {
    if (existing) {
      db.prepare("DELETE FROM shares WHERE id = ?").run(existing.id);
    }
    return null;
  }

  let slug = existing?.slug;
  if (options.customSlug && options.customSlug.trim()) {
    slug = validateCustomSlug(options.customSlug);
    const conflict = getShareBySlug(slug);
    if (conflict && conflict.id !== existing?.id) {
      throw new Error("Share slug already exists");
    }
  } else if (!slug) {
    slug = await generateUniqueSlug();
  }

  let passwordHash = existing?.password_hash ?? null;
  if (options.passwordEnabled) {
    if (typeof options.password === "string" && options.password.length >= 4) {
      passwordHash = await hashPassword(options.password);
    } else if (!passwordHash) {
      throw new Error("Share password is required");
    }
  } else {
    passwordHash = null;
  }

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE shares
       SET slug = ?, password_hash = ?, updated_at = ?
       WHERE id = ?`
    ).run(slug, passwordHash, now, existing.id);
    const updated = getShareForUser(options.user.id, options.filename)!;
    return toShareSummary(updated);
  }

  db.prepare(
    `INSERT INTO shares (user_id, filename, slug, password_hash, view_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(options.user.id, options.filename, slug, passwordHash, now, now);

  const created = getShareForUser(options.user.id, options.filename)!;
  return toShareSummary(created);
}

export function deleteShareForUser(userId: number, filename: string): void {
  getDb().prepare("DELETE FROM shares WHERE user_id = ? AND filename = ?").run(userId, filename);
}

export function renameShareFilenameForUser(userId: number, oldFilename: string, newFilename: string): void {
  getDb()
    .prepare("UPDATE shares SET filename = ?, updated_at = ? WHERE user_id = ? AND filename = ?")
    .run(newFilename, new Date().toISOString(), userId, oldFilename);
}

export async function updateShareById(options: {
  id: number;
  customSlug?: string;
  passwordEnabled?: boolean;
  password?: string;
}): Promise<ShareSummary> {
  const share = getShareById(options.id);
  if (!share) {
    throw new Error("Share not found");
  }

  let slug = share.slug;
  if (typeof options.customSlug === "string" && options.customSlug.trim()) {
    slug = validateCustomSlug(options.customSlug);
    const conflict = getShareBySlug(slug);
    if (conflict && conflict.id !== share.id) {
      throw new Error("Share slug already exists");
    }
  }

  let passwordHash = share.password_hash;
  if (options.passwordEnabled === false) {
    passwordHash = null;
  } else if (options.passwordEnabled === true) {
    if (typeof options.password === "string" && options.password.length >= 4) {
      passwordHash = await hashPassword(options.password);
    } else if (!passwordHash) {
      throw new Error("Share password is required");
    }
  }

  getDb()
    .prepare("UPDATE shares SET slug = ?, password_hash = ?, updated_at = ? WHERE id = ?")
    .run(slug, passwordHash, new Date().toISOString(), share.id);

  return toShareSummary(getShareById(share.id)!);
}

export function deleteShareById(id: number): void {
  getDb().prepare("DELETE FROM shares WHERE id = ?").run(id);
}

export async function accessPublicShare(slug: string, password?: string): Promise<{
  filename?: string;
  content?: string;
  requiresPassword: boolean;
}> {
  const share = getShareBySlug(slug);
  if (!share) {
    throw new Error("Share not found");
  }

  if (share.password_hash) {
    if (!password) {
      return {
        requiresPassword: true
      };
    }

    const valid = await argonVerify(share.password_hash, password);
    if (!valid) {
      throw new Error("Invalid share password");
    }
  }

  const owner = getDb().prepare("SELECT * FROM users WHERE id = ?").get(share.user_id) as UserRecord | undefined;
  if (!owner || owner.blocked) {
    throw new Error("Share not found");
  }

  const note = await readNote(owner.username, share.filename);
  getDb()
    .prepare("UPDATE shares SET view_count = view_count + 1, updated_at = updated_at WHERE id = ?")
    .run(share.id);

  return {
    filename: note.filename,
    content: note.content,
    requiresPassword: false
  };
}
