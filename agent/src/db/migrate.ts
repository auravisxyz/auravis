import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import { createClient } from "./client.js";

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
  const client = createClient(config.databaseUrl);

  // Applied in order, every run. Each file uses `create table if not exists`,
  // so re-running is a no-op — simpler than a migrations ledger for a build
  // this size, and it means anyone can bring a fresh database up in one step.
  const files = ["0001_init.sql", "0002_drafts.sql"];
  for (const file of files) {
    console.log(`Applying migrations/${file} …`);
    await client.unsafe(readFileSync(path.join(dir, "migrations", file), "utf8"));
  }

  const [triggers] = await client`select count(*)::int as n from triggers`;
  const [executions] = await client`select count(*)::int as n from executions`;
  const [drafts] = await client`select count(*)::int as n from drafts`;
  console.log(
    `Done. triggers=${triggers?.n ?? "?"} executions=${executions?.n ?? "?"} ` +
      `drafts=${drafts?.n ?? "?"} rows.`,
  );

  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
