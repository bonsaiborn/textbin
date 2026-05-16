const FILENAME_RE = /^[a-z0-9_-]+\.txt$/;
const USERNAME_RE = /^[a-z0-9_-]{3,64}$/;

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
