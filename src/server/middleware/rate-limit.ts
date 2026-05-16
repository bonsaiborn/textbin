export function isExplicitlyBlockedPath(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  const rawPathname = url.split("?")[0];
  const pathname = rawPathname.toLowerCase();
  let decodedPathname = pathname;

  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    decodedPathname = pathname;
  }

  return (
    pathname === "/data" ||
    pathname.startsWith("/data/") ||
    pathname === "/notes" ||
    pathname.startsWith("/notes/") ||
    decodedPathname.includes("..") ||
    decodedPathname.includes("\\") ||
    pathname.endsWith(".sqlite") ||
    pathname.endsWith(".db")
  );
}
