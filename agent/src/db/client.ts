import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { config } from "../config.js";
import * as schema from "./schema.js";

let _db: PostgresJsDatabase<typeof schema> | null = null;

/**
 * Lazily creates the DB connection on first use, and returns null when
 * DATABASE_URL isn't configured — mirrors the same "degrade, don't crash"
 * pattern price.ts uses for OKX credentials. Local dev and early demo
 * rehearsal work fine with an empty trigger list; Postgres is only required
 * once triggers need to persist across agent restarts.
 */
export function getDb(): PostgresJsDatabase<typeof schema> | null {
  if (!config.databaseUrl) return null;
  if (!_db) {
    _db = drizzle(createClient(config.databaseUrl), { schema });
  }
  return _db;
}

/**
 * Hosted Postgres (Neon, Supabase) requires TLS. postgres.js reads `sslmode`
 * from the URL, but the providers' copy-paste strings don't always include it
 * and the resulting error ("connection is insecure") is unhelpfully worded.
 * Setting it explicitly for known-hosted providers avoids that dead end.
 */
export function createClient(url: string) {
  const needsSsl = /neon\.tech|supabase\.(co|com)|render\.com|railway/.test(url);
  const alreadySpecified = /sslmode=/.test(url);

  return postgres(url, {
    max: 5,
    ...(needsSsl && !alreadySpecified ? { ssl: "require" as const } : {}),
  });
}
