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
    const client = postgres(config.databaseUrl, { max: 5 });
    _db = drizzle(client, { schema });
  }
  return _db;
}
