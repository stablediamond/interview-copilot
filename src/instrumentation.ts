/**
 * Next.js startup hook. Runs once when the server boots (dev, `next start`, and
 * the packaged standalone server). We use it to bring the SQLite schema up to
 * date before any request hits the database.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyPendingMigrations } = await import("./lib/migrate-runtime");
  await applyPendingMigrations();
}
