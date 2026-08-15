import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export { schema };

let _db: PostgresJsDatabase<typeof schema> | null = null;

/**
 * ⚠️ `./schema.ts` and `./abi.ts` are COPIES of the agent's versions
 * (`agent/src/db/schema.ts`, `agent/src/abi/AuravisMandate.ts`). Next.js can't
 * import from outside its own root without awkward config, so they were
 * duplicated.
 *
 * That means they can silently drift: change a column in the agent and this
 * app keeps compiling against the old shape until something fails at runtime.
 * `npm run check:sync` from the repo root diffs them — run it after touching
 * either file. Proper fix is to hoist both into @auravis/shared, which is
 * already transpiled here; not worth the churn before the deadline.
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");

    const needsSsl = /neon\.tech|supabase\.(co|com)|render\.com|railway/.test(url);
    const alreadySpecified = /sslmode=/.test(url);

    _db = drizzle(
      postgres(url, {
        max: 5,
        ...(needsSsl && !alreadySpecified ? { ssl: "require" as const } : {}),
      }),
      { schema },
    );
  }
  return _db;
}
