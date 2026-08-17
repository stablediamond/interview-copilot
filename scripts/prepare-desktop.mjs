// Assembles the Next.js standalone output for Electron packaging and builds a
// pre-migrated SQLite template that ships inside the installer.
// Run after `next build` (which must have `output: "standalone"`).
import { cpSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error(
    "Missing .next/standalone — run `next build` (output: 'standalone') first."
  );
  process.exit(1);
}

// Next's standalone server does not include static assets or public/.
cpSync(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true }
);

if (existsSync(path.join(root, "public"))) {
  cpSync(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
}

// Prisma reads the schema at runtime.
cpSync(
  path.join(root, "prisma", "schema.prisma"),
  path.join(standalone, "prisma", "schema.prisma")
);

// Ship the migrations so the app can bring an existing user database up to date
// on launch (the seed copy happens only once; updates must still migrate).
cpSync(
  path.join(root, "prisma", "migrations"),
  path.join(standalone, "prisma", "migrations"),
  { recursive: true }
);

// Build the initial migrated database that gets copied to the user's profile
// on first launch.
const seedDb = path.join(root, "prisma", "seed.db");
rmSync(seedDb, { force: true });
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: `file:${seedDb}` },
});

console.log("Desktop assets prepared (standalone + seed.db).");
