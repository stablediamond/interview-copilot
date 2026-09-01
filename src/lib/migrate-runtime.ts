import { promises as fs } from "fs";
import path from "path";
import { prisma } from "./db";

/**
 * Apply any pending Prisma migrations to the live SQLite database at startup.
 *
 * The packaged desktop app copies a seed database into the user's profile on
 * first launch and then reuses it forever — there is no `prisma migrate deploy`
 * step on the user's machine, so a schema change shipped in an update would
 * otherwise fail at runtime ("column X does not exist"). This runs the bundled
 * migration SQL against whatever database the app is pointed at, idempotently:
 * statements that were already applied (duplicate column / table exists) are
 * ignored, and a small ledger table skips work on subsequent launches.
 *
 * Forward-only and additive — matches how this app evolves its schema.
 */
let ran = false;

export async function applyPendingMigrations(): Promise<void> {
  if (ran) return;
  ran = true;

  const dir = await findMigrationsDir();
  if (!dir) {
    console.warn("[migrate] migrations directory not found; skipping");
    return;
  }

  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "_runtime_migrations" ("name" TEXT PRIMARY KEY, "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    );

    const appliedRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT "name" FROM "_runtime_migrations"`
    );
    const applied = new Set(appliedRows.map((r) => r.name));

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const migrations = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort(); // timestamp-prefixed names sort chronologically

    for (const name of migrations) {
      if (applied.has(name)) continue;

      const sqlPath = path.join(dir, name, "migration.sql");
      let raw: string;
      try {
        raw = await fs.readFile(sqlPath, "utf8");
      } catch {
        continue; // not a migration directory
      }

      for (const statement of splitStatements(raw)) {
        try {
          await prisma.$executeRawUnsafe(statement);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Already-applied DDL on an existing DB — safe to ignore.
          if (/duplicate column name|already exists/i.test(msg)) continue;
          throw err;
        }
      }

      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "_runtime_migrations" ("name") VALUES (?)`,
        name
      );
      console.log(`[migrate] applied ${name}`);
    }
  } catch (err) {
    // Don't crash the server; surface a clear log. A genuinely broken schema
    // will still produce specific query errors the user can report.
    console.error("[migrate] failed to apply migrations:", err);
  }
}

/** Strip full-line SQL comments and split into individual statements. */
function splitStatements(raw: string): string[] {
  return raw
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Locate the bundled migrations directory across dev, `next start`, and packaged runs. */
async function findMigrationsDir(): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), "prisma", "migrations"),
    path.join(process.cwd(), "..", "prisma", "migrations"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}
