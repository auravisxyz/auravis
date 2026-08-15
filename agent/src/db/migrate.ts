import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { config } from "../config.js";

/**
 * Applies migrations/0001_init.sql directly, no drizzle-kit involved. For a
 * six-day build with one migration, a plain SQL file that anyone can also
 * paste into the Neon/Supabase SQL editor is simpler than pulling in a CLI.
 * Run with: npm run db:migrate
 */
async function main() {
  if (!config.databaseUrl) {
    console.error("DATABASE_URL is not set — nothing to migrate.");
    process.exit(1);
  }

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(dir, "migrations", "0001_init.sql"), "utf8");

  const client = postgres(config.databaseUrl, { max: 1 });
  console.log("Applying migrations/0001_init.sql ...");
  await client.unsafe(sql);
  console.log("Done.");
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
