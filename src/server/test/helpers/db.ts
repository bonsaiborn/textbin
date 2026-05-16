export async function importTestDb() {
  const { getDb } = await import("../../db.js");
  return getDb();
}
