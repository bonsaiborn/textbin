import fs from "node:fs";
import { findUserByUsername, hashPassword } from "../auth.js";
import { getDb } from "../db.js";
import { listNotesForUser, resolveUserNotesDir } from "./notes.service.js";
import type { UserRecord, UserRole } from "../types.js";

export function parseRole(value: unknown): UserRole | undefined {
  return value === "admin" || value === "user" ? value : undefined;
}

export function parseBooleanFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function normalizeUsername(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (!/^[a-z0-9_-]{3,64}$/.test(normalized)) {
    throw new Error("Invalid username");
  }

  return normalized;
}

export async function buildUserSummary(user: UserRecord) {
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

export async function listUserSummaries() {
  const users = getDb().prepare("SELECT * FROM users ORDER BY id ASC").all() as UserRecord[];
  return Promise.all(users.map((user) => buildUserSummary(user)));
}

export function getUserById(id: number | string) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
}

export async function createUserAccount(username: string, password: string, role: UserRole) {
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const result = getDb().prepare(
    `INSERT INTO users (username, password_hash, role, blocked, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`
  ).run(username, passwordHash, role, now, now);
  const created = getDb().prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as UserRecord;
  return buildUserSummary(created);
}

export async function updateUserPassword(userId: number | string, password: string) {
  const passwordHash = await hashPassword(password);
  getDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, new Date().toISOString(), userId);
}

export function updateUserRole(userId: number | string, role: UserRole) {
  getDb().prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, new Date().toISOString(), userId);
}

export function updateUserBlocked(userId: number | string, blocked: boolean) {
  getDb().prepare("UPDATE users SET blocked = ?, updated_at = ? WHERE id = ?").run(blocked ? 1 : 0, new Date().toISOString(), userId);
}

export function deleteUserAccount(userId: number | string, username: string) {
  getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
  fs.rmSync(resolveUserNotesDir(username), { recursive: true, force: true });
}

export { findUserByUsername };
