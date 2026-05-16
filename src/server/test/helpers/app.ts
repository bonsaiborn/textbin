import type { FastifyInstance } from "fastify";
import { vi } from "vitest";
import { createTempWorkspace, removeTempWorkspace } from "./filesystem.js";

export interface TestAppContext {
  app: FastifyInstance;
  rootDir: string;
  dataDir: string;
  notesDir: string;
  dbFilename: string;
  cleanup: () => Promise<void>;
}

export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestAppContext> {
  const workspace = await createTempWorkspace();
  const env = {
    NODE_ENV: "test",
    APP_URL: "http://localhost:3003",
    APP_SECRET: "test_secret_123_change_me",
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "change_me_123",
    RESET_ADMIN_ON_START: "false",
    DB_FILENAME: workspace.dbFilename,
    NOTES_DIR: workspace.notesDir,
    MAX_NOTE_SIZE: "262144",
    LOGIN_MAX_FAILED_ATTEMPTS: "3",
    LOGIN_ATTEMPT_WINDOW_MINUTES: "10",
    LOGIN_BLOCK_MINUTES: "15",
    SESSION_DAYS: "14",
    COOKIE_SECURE: "false",
    TRUST_PROXY: "true",
    PORT: "3000",
    ...envOverrides
  };

  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  vi.resetModules();
  const { createApp } = await import("../../app.js");
  const { closeDb } = await import("../../db.js");
  const app = await createApp();
  await app.ready();

  return {
    app,
    ...workspace,
    cleanup: async () => {
      await app.close();
      closeDb();
      vi.resetModules();
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await removeTempWorkspace(workspace.rootDir);
    }
  };
}
