import crypto from "node:crypto";
import { verify as argonVerify } from "@node-rs/argon2";
import { config, defaultInstanceSettings } from "./config.js";
import { getDb, getInstanceSettings } from "./db.js";
import { getClientIp, hashPassword } from "./auth.js";
import { createRevisionBackup, readNote, updateNote } from "./notes.js";
import type { ShareLinkKind, ShareRecord, ShareState, ShareSummary, UserRecord } from "./types.js";

const MIN_READ_SLUG_LENGTH = 8;
const MIN_EDIT_SLUG_LENGTH = 16;
const MAX_SLUG_LENGTH = 64;
const PUBLIC_LINK_ATTEMPT_ACTION_READ = "read_password";
const PUBLIC_LINK_ATTEMPT_ACTION_EDIT = "edit_password";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMinSlugLength(kind: ShareLinkKind): number {
  return kind === "edit" ? MIN_EDIT_SLUG_LENGTH : MIN_READ_SLUG_LENGTH;
}

function getShareState(record: ShareRecord): ShareState {
  if (record.edit_enabled && record.edit_slug) {
    return "edit";
  }

  if (record.read_enabled && record.read_slug) {
    return "read";
  }

  return "disabled";
}

function getLinkField(kind: ShareLinkKind): "read_slug" | "edit_slug" {
  return kind === "edit" ? "edit_slug" : "read_slug";
}

function getEnabledField(kind: ShareLinkKind): "read_enabled" | "edit_enabled" {
  return kind === "edit" ? "edit_enabled" : "read_enabled";
}

function getAttemptAction(kind: ShareLinkKind): string {
  return kind === "edit" ? PUBLIC_LINK_ATTEMPT_ACTION_EDIT : PUBLIC_LINK_ATTEMPT_ACTION_READ;
}

function getSharePattern(kind: ShareLinkKind, charset: string): RegExp {
  const minLength = getMinSlugLength(kind);
  return new RegExp(`^[${escapeRegExp(charset)}]{${minLength},${MAX_SLUG_LENGTH}}$`);
}

function isExpired(record: ShareRecord): boolean {
  return Boolean(record.expires_at && new Date(record.expires_at).getTime() <= Date.now());
}

function isLinkActive(record: ShareRecord, kind: ShareLinkKind): boolean {
  const enabledField = getEnabledField(kind);
  const slugField = getLinkField(kind);
  return Boolean(record[enabledField] && record[slugField] && !isExpired(record));
}

function normalizeExpiration(value?: string): string | null {
  if (!value || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid share expiration");
  }

  return parsed.toISOString();
}

function ensureExpirationAvailable(record: ShareRecord): void {
  if (!isExpired(record)) {
    return;
  }

  throw new Error("Share not found");
}

function recordPublicLinkAttempt(slug: string, ip: string, action: string, success: boolean): void {
  getDb().prepare(
    `INSERT INTO public_link_attempts (slug, ip, action, success, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(slug, ip, action, success ? 1 : 0, new Date().toISOString());
}

function isPublicLinkRateLimited(slug: string, ip: string, action: string): boolean {
  const windowCutoff = new Date(Date.now() - config.loginAttemptWindowMinutes * 60_000).toISOString();
  const failures = getDb()
    .prepare(
      `SELECT created_at
       FROM public_link_attempts
       WHERE slug = ?
         AND ip = ?
         AND action = ?
         AND success = 0
         AND created_at >= ?`
    )
    .all(slug, ip, action, windowCutoff) as Array<{ created_at: string }>;

  if (failures.length < config.loginMaxFailedAttempts) {
    return false;
  }

  const latestFailureAt = failures
    .map((failure) => new Date(failure.created_at).getTime())
    .sort((left, right) => right - left)[0];

  return latestFailureAt >= Date.now() - config.loginBlockMinutes * 60_000;
}

function getOwnerForShare(record: ShareRecord): UserRecord | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(record.user_id) as UserRecord | undefined;
}

export function toShareSummary(record: ShareRecord): ShareSummary {
  return {
    filename: record.filename,
    state: getShareState(record),
    readEnabled: Boolean(record.read_enabled),
    readSlug: record.read_slug,
    readUrlPath: record.read_slug ? `/s/${record.read_slug}` : null,
    editEnabled: Boolean(record.edit_enabled),
    editSlug: record.edit_slug,
    editUrlPath: record.edit_slug ? `/e/${record.edit_slug}` : null,
    hasPassword: Boolean(record.password_hash),
    expiresAt: record.expires_at,
    viewCount: record.view_count,
    editCount: record.edit_count,
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
    .prepare(
      `SELECT *
       FROM shares
       WHERE user_id = ?
         AND (read_enabled = 1 OR edit_enabled = 1)
       ORDER BY updated_at DESC, id DESC`
    )
    .all(userId) as ShareRecord[];
  return rows.map(toShareSummary);
}

export function getShareByReadSlug(slug: string): ShareRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM shares WHERE read_slug = ? AND read_enabled = 1")
    .get(slug) as ShareRecord | undefined;
}

export function getShareByEditSlug(slug: string): ShareRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM shares WHERE edit_slug = ? AND edit_enabled = 1")
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
       WHERE shares.read_enabled = 1 OR shares.edit_enabled = 1
       ORDER BY shares.updated_at DESC, shares.id DESC`
    )
    .all() as Array<ShareRecord & { username: string }>;

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    ...toShareSummary(row)
  }));
}

export function validateCustomSlug(slug: string, kind: ShareLinkKind): string {
  const normalized = slug.trim().toLowerCase();
  const settings = getInstanceSettings();
  const charset = settings.shareCharset || defaultInstanceSettings.shareCharset;
  const pattern = getSharePattern(kind, charset);

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

async function generateUniqueSlug(kind: ShareLinkKind): Promise<string> {
  const settings = getInstanceSettings();
  const desiredLength = kind === "edit" ? settings.defaultEditSlugLength : settings.defaultReadSlugLength;
  const length = Math.min(MAX_SLUG_LENGTH, Math.max(getMinSlugLength(kind), desiredLength));
  const charset = settings.shareCharset || defaultInstanceSettings.shareCharset;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = generateSlug(length, charset);
    const existing = kind === "edit" ? getShareByEditSlug(slug) : getShareByReadSlug(slug);
    if (!existing) {
      return slug;
    }
  }

  throw new Error("Could not generate unique share slug");
}

async function resolveSlug(
  kind: ShareLinkKind,
  existingRecord: ShareRecord | undefined,
  incomingSlug: string | undefined,
  regenerate: boolean
): Promise<string | null> {
  const currentSlug = kind === "edit" ? existingRecord?.edit_slug ?? null : existingRecord?.read_slug ?? null;

  if (incomingSlug && incomingSlug.trim()) {
    const slug = validateCustomSlug(incomingSlug, kind);
    const conflict = kind === "edit" ? getShareByEditSlug(slug) : getShareByReadSlug(slug);
    if (conflict && conflict.id !== existingRecord?.id) {
      throw new Error("Share slug already exists");
    }
    return slug;
  }

  if (!regenerate && currentSlug) {
    return currentSlug;
  }

  return generateUniqueSlug(kind);
}

function assertShareAccessible(record: ShareRecord, kind: ShareLinkKind): UserRecord {
  if (!isLinkActive(record, kind)) {
    throw new Error("Share not found");
  }

  ensureExpirationAvailable(record);
  const owner = getOwnerForShare(record);
  if (!owner || owner.blocked) {
    throw new Error("Share not found");
  }

  return owner;
}

export async function upsertShareForUser(options: {
  user: Pick<UserRecord, "id" | "username">;
  filename: string;
  readEnabled: boolean;
  editEnabled: boolean;
  readCustomSlug?: string;
  editCustomSlug?: string;
  passwordEnabled: boolean;
  password?: string;
  expiresAt?: string;
  regenerateRead?: boolean;
  regenerateEdit?: boolean;
}): Promise<ShareSummary | null> {
  const db = getDb();
  const existing = getShareForUser(options.user.id, options.filename);

  if (!options.readEnabled && !options.editEnabled) {
    if (existing) {
      db.prepare("DELETE FROM shares WHERE id = ?").run(existing.id);
    }
    return null;
  }

  const readSlug = options.readEnabled
    ? await resolveSlug("read", existing, options.readCustomSlug, Boolean(options.regenerateRead))
    : null;
  const editSlug = options.editEnabled
    ? await resolveSlug("edit", existing, options.editCustomSlug, Boolean(options.regenerateEdit))
    : null;

  const expiresAt = normalizeExpiration(options.expiresAt);

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
       SET read_enabled = ?, read_slug = ?, edit_enabled = ?, edit_slug = ?, password_hash = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(options.readEnabled ? 1 : 0, readSlug, options.editEnabled ? 1 : 0, editSlug, passwordHash, expiresAt, now, existing.id);
    const updated = getShareForUser(options.user.id, options.filename)!;
    return toShareSummary(updated);
  }

  db.prepare(
    `INSERT INTO shares (
      user_id,
      filename,
      read_enabled,
      read_slug,
      edit_enabled,
      edit_slug,
      password_hash,
      expires_at,
      view_count,
      edit_count,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(
    options.user.id,
    options.filename,
    options.readEnabled ? 1 : 0,
    readSlug,
    options.editEnabled ? 1 : 0,
    editSlug,
    passwordHash,
    expiresAt,
    now,
    now
  );

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
  kind?: ShareLinkKind;
  customSlug?: string;
  passwordEnabled?: boolean;
  password?: string;
  regenerate?: boolean;
  expiresAt?: string;
}): Promise<ShareSummary> {
  const share = getShareById(options.id);
  if (!share) {
    throw new Error("Share not found");
  }

  const kind = options.kind ?? "read";
  const readSlug = kind === "read"
    ? await resolveSlug("read", share, options.customSlug, Boolean(options.regenerate))
    : share.read_slug;
  const editSlug = kind === "edit"
    ? await resolveSlug("edit", share, options.customSlug, Boolean(options.regenerate))
    : share.edit_slug;

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

  const expiresAt = options.expiresAt === undefined ? share.expires_at : normalizeExpiration(options.expiresAt);

  getDb()
    .prepare(
      `UPDATE shares
       SET read_slug = ?, edit_slug = ?, password_hash = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(readSlug, editSlug, passwordHash, expiresAt, new Date().toISOString(), share.id);

  return toShareSummary(getShareById(share.id)!);
}

export function deleteShareById(id: number): void {
  getDb().prepare("DELETE FROM shares WHERE id = ?").run(id);
}

export async function accessPublicShare(
  slug: string,
  password?: string,
  ip = "unknown"
): Promise<{
  filename?: string;
  content?: string;
  requiresPassword: boolean;
}> {
  const share = getShareByReadSlug(slug);
  if (!share) {
    throw new Error("Share not found");
  }

  const action = getAttemptAction("read");
  if (isPublicLinkRateLimited(slug, ip, action)) {
    throw new Error("Public link rate limited");
  }

  if (share.password_hash) {
    if (!password) {
      return {
        requiresPassword: true
      };
    }

    const valid = await argonVerify(share.password_hash, password);
    recordPublicLinkAttempt(slug, ip, action, valid);
    if (!valid) {
      throw new Error("Invalid share password");
    }
  }

  const owner = assertShareAccessible(share, "read");
  const note = await readNote(owner.username, share.filename);
  getDb()
    .prepare("UPDATE shares SET view_count = view_count + 1 WHERE id = ?")
    .run(share.id);

  return {
    filename: note.filename,
    content: note.content,
    requiresPassword: false
  };
}

export async function verifyPublicEditAccess(
  slug: string,
  password: string | undefined,
  ip: string
): Promise<ShareRecord> {
  const share = getShareByEditSlug(slug);
  if (!share) {
    throw new Error("Share not found");
  }

  const owner = assertShareAccessible(share, "edit");
  void owner;

  const action = getAttemptAction("edit");
  if (isPublicLinkRateLimited(slug, ip, action)) {
    throw new Error("Public edit rate limited");
  }

  if (!share.password_hash) {
    recordPublicLinkAttempt(slug, ip, action, true);
    return share;
  }

  if (!password) {
    recordPublicLinkAttempt(slug, ip, action, false);
    throw new Error("Invalid share password");
  }

  const valid = await argonVerify(share.password_hash, password);
  recordPublicLinkAttempt(slug, ip, action, valid);
  if (!valid) {
    throw new Error("Invalid share password");
  }

  return share;
}

export async function openPublicEdit(
  slug: string,
  hasAccess: boolean
): Promise<{
  filename?: string;
  content?: string;
  requiresPassword: boolean;
  expiresAt: string | null;
}> {
  const share = getShareByEditSlug(slug);
  if (!share) {
    throw new Error("Share not found");
  }

  const owner = assertShareAccessible(share, "edit");
  if (share.password_hash && !hasAccess) {
    return {
      requiresPassword: true,
      expiresAt: share.expires_at
    };
  }

  const note = await readNote(owner.username, share.filename);
  return {
    filename: note.filename,
    content: note.content,
    requiresPassword: false,
    expiresAt: share.expires_at
  };
}

export async function savePublicEdit(
  slug: string,
  content: string
): Promise<{ filename: string; editCount: number }> {
  const share = getShareByEditSlug(slug);
  if (!share) {
    throw new Error("Share not found");
  }

  const owner = assertShareAccessible(share, "edit");
  await createRevisionBackup(owner.username, share.filename);
  await updateNote(owner.username, share.filename, content);
  getDb()
    .prepare("UPDATE shares SET edit_count = edit_count + 1 WHERE id = ?")
    .run(share.id);

  const updated = getShareById(share.id)!;
  return {
    filename: updated.filename,
    editCount: updated.edit_count
  };
}

export function createPublicEditGrantToken(share: ShareRecord): string {
  const payload = `${share.id}:${share.edit_slug ?? ""}:${share.password_hash ?? ""}:${share.expires_at ?? ""}`;
  const signature = crypto
    .createHmac("sha256", config.appSecret)
    .update(payload)
    .digest("hex");

  return `${share.id}.${signature}`;
}

export function hasPublicEditGrant(share: ShareRecord, token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  const [idPart, signature] = token.split(".", 2);
  if (!idPart || !signature || Number.parseInt(idPart, 10) !== share.id) {
    return false;
  }

  return createPublicEditGrantToken(share) === token;
}
