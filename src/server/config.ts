import path from "node:path";
import type { InstanceSettings } from "./types.js";

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInt(name: string, fallback: string): number {
  const raw = process.env[name] ?? fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${name}`);
  }
  return parsed;
}

function parseBoolean(name: string, fallback: string): boolean {
  const raw = (process.env[name] ?? fallback).toLowerCase();
  return raw === "true";
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  appUrl: requireEnv("APP_URL", "http://localhost:3000"),
  appSecret: requireEnv("APP_SECRET", "change_me_long_random_secret"),
  adminUsername: requireEnv("ADMIN_USERNAME", "admin"),
  adminPassword: requireEnv("ADMIN_PASSWORD", "change_me"),
  resetAdminOnStart: parseBoolean("RESET_ADMIN_ON_START", "false"),
  dbFilename: path.resolve(requireEnv("DB_FILENAME", "./data/app.sqlite")),
  notesDir: path.resolve(requireEnv("NOTES_DIR", "./data/notes")),
  maxNoteSize: parsePositiveInt("MAX_NOTE_SIZE", "262144"),
  loginMaxFailedAttempts: parsePositiveInt("LOGIN_MAX_FAILED_ATTEMPTS", "5"),
  loginAttemptWindowMinutes: parsePositiveInt("LOGIN_ATTEMPT_WINDOW_MINUTES", "10"),
  loginBlockMinutes: parsePositiveInt("LOGIN_BLOCK_MINUTES", "15"),
  cookieSecure: parseBoolean("COOKIE_SECURE", "false"),
  trustProxy: parseBoolean("TRUST_PROXY", "true"),
  port: parsePositiveInt("PORT", "3000"),
  sessionDays: 14
};

export const isProduction = config.nodeEnv === "production";

export const defaultInstanceSettings: InstanceSettings = {
  defaultTheme: "dark",
  shareSlugLength: 10,
  shareCharset: "abcdefghijklmnopqrstuvwxyz0123456789"
};
