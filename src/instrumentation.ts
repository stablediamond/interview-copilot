/**
 * Next.js startup hook. Runs once when the server boots (dev, `next start`, and
 * the packaged standalone server). We use it to bring the SQLite schema up to
 * date before any request hits the database.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = "file:./dev.db";
  }
  // Separate file so Edge compilation of instrumentation.ts does not follow
  // Node-only fs/Prisma imports (webpack IgnorePlugin also drops this on Edge).
  const { applyPendingMigrations } = await import("./instrumentation.node");
  await applyPendingMigrations();
}
