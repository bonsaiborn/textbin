import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { config, defaultInstanceSettings } from "./config.js";
import { assertSafeUsername, sanitizeTitleToFilename } from "./notes.js";
import type { InstanceSettings, UserRecord, UserRole } from "./types.js";

let dbInstance: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!dbInstance) {
    fs.mkdirSync(path.dirname(config.dbFilename), { recursive: true });
    dbInstance = new Database(config.dbFilename);
  }

  return dbInstance;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureSchemaMigrations(db: Database.Database): void {
  if (!hasColumn(db, "users", "role")) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  }

  if (!hasColumn(db, "users", "blocked")) {
    db.exec(`ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0`);
  }
}

function getFirstUser(db: Database.Database): UserRecord | undefined {
  return db.prepare("SELECT * FROM users ORDER BY id ASC LIMIT 1").get() as UserRecord | undefined;
}

function ensureSettingsTable(db: Database.Database): void {
  const now = new Date().toISOString();
  const entries: Array<[keyof InstanceSettings, string]> = [
    ["defaultTheme", defaultInstanceSettings.defaultTheme],
    ["shareSlugLength", String(defaultInstanceSettings.shareSlugLength)],
    ["shareCharset", defaultInstanceSettings.shareCharset]
  ];

  const statement = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)`
  );

  for (const [key, value] of entries) {
    statement.run(key, value, now);
  }
}

function makeUniqueLegacyTarget(targetDir: string, filename: string): string {
  const extension = ".txt";
  const stem = filename.slice(0, -extension.length);
  let candidate = filename;
  let counter = 2;

  while (fs.existsSync(path.join(targetDir, candidate))) {
    candidate = `${stem}-${counter}${extension}`;
    counter += 1;
  }

  return path.join(targetDir, candidate);
}

function migrateUserNotesDir(fromUsername: string, toUsername: string): void {
  if (fromUsername === toUsername) {
    return;
  }

  const fromDir = path.join(config.notesDir, fromUsername);
  const toDir = path.join(config.notesDir, toUsername);

  if (!fs.existsSync(fromDir)) {
    fs.mkdirSync(toDir, { recursive: true });
    return;
  }

  if (!fs.existsSync(toDir)) {
    fs.renameSync(fromDir, toDir);
    return;
  }

  const entries = fs.readdirSync(fromDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".txt"));
  for (const entry of entries) {
    const source = path.join(fromDir, entry.name);
    const target = makeUniqueLegacyTarget(toDir, entry.name);
    fs.renameSync(source, target);
  }
  fs.rmSync(fromDir, { recursive: true, force: true });
}

function migrateLegacyRootNotes(username: string): void {
  const entries = fs.readdirSync(config.notesDir, { withFileTypes: true });
  const legacyFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".txt"));
  if (legacyFiles.length === 0) {
    return;
  }

  const userNotesDir = path.join(config.notesDir, username);
  fs.mkdirSync(userNotesDir, { recursive: true });

  for (const file of legacyFiles) {
    const source = path.join(config.notesDir, file.name);
    const target = makeUniqueLegacyTarget(userNotesDir, sanitizeTitleToFilename(file.name.replace(/\.txt$/i, "")));
    fs.renameSync(source, target);
  }
}

export async function initializeDatabase(): Promise<void> {
  fs.mkdirSync(config.notesDir, { recursive: true });
  const db = getDb();

  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip TEXT NOT NULL,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_login_attempts_username_ip_created
    ON login_attempts (username, ip, created_at);

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
    ON sessions (token_hash);

    CREATE INDEX IF NOT EXISTS idx_shares_user_id
    ON shares (user_id);
  `);
  ensureSchemaMigrations(db);
  ensureSettingsTable(db);

  const now = new Date().toISOString();
  const passwordHash = await hash(config.adminPassword, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
  const firstUser = getFirstUser(db);

  if (!firstUser) {
    assertSafeUsername(config.adminUsername);
    db.prepare(
      `INSERT INTO users (username, password_hash, role, blocked, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`
    ).run(config.adminUsername, passwordHash, "admin" satisfies UserRole, now, now);
    fs.mkdirSync(path.join(config.notesDir, config.adminUsername), { recursive: true });
    return;
  }

  if (config.resetAdminOnStart) {
    assertSafeUsername(config.adminUsername);
    const oldUsername = firstUser.username;
    const usernameConflict = db
      .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
      .get(config.adminUsername, firstUser.id) as { id: number } | undefined;
    if (usernameConflict) {
      throw new Error("RESET_ADMIN_ON_START username conflicts with an existing user");
    }
    db.prepare(
      `UPDATE users
       SET username = ?, password_hash = ?, role = 'admin', blocked = 0, updated_at = ?
       WHERE id = ?`
    ).run(config.adminUsername, passwordHash, now, firstUser.id);
    migrateUserNotesDir(oldUsername, config.adminUsername);
  }

  const currentFirstUser = getFirstUser(db);
  if (currentFirstUser) {
    if (currentFirstUser.role !== "admin") {
      db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(now, currentFirstUser.id);
    }
    fs.mkdirSync(path.join(config.notesDir, currentFirstUser.username), { recursive: true });
    migrateLegacyRootNotes(currentFirstUser.username);
  }
}

export function getInstanceSettings(): InstanceSettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: keyof InstanceSettings; value: string }>;
  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    defaultTheme:
      map.get("defaultTheme") === "light"
        ? "light"
        : map.get("defaultTheme") === "system"
          ? "system"
          : defaultInstanceSettings.defaultTheme,
    shareSlugLength: Number.parseInt(map.get("shareSlugLength") ?? String(defaultInstanceSettings.shareSlugLength), 10),
    shareCharset: map.get("shareCharset") ?? defaultInstanceSettings.shareCharset
  };
}

export function updateInstanceSettings(next: InstanceSettings): InstanceSettings {
  const db = getDb();
  const now = new Date().toISOString();
  const statement = db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  statement.run("defaultTheme", next.defaultTheme, now);
  statement.run("shareSlugLength", String(next.shareSlugLength), now);
  statement.run("shareCharset", next.shareCharset, now);
  return getInstanceSettings();
}
