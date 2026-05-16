import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempWorkspace(prefix = "textbin-test-") {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(rootDir, "data");
  const notesDir = path.join(dataDir, "notes");
  const dbFilename = path.join(dataDir, "app.sqlite");
  await fs.mkdir(notesDir, { recursive: true });
  return { rootDir, dataDir, notesDir, dbFilename };
}

export async function removeTempWorkspace(rootDir: string) {
  await fs.rm(rootDir, { recursive: true, force: true });
}
