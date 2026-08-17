/**
 * add-indexes-r22.ts (r22-speed) - idempotent index migration for explore_places.
 *
 * explore.list fetches the caller's own submissions (addedById = ?) on every
 * global feed load. addedById had no index, so that lookup was a ~560ms full
 * table scan over 420k+ rows, dominating the warm-cache feed response.
 *
 * Adds:
 *   idx_explore_addedby (addedById) - per-user submission lookups
 *
 * IDEMPOTENT: checks information_schema.statistics first, online DDL
 * (ALGORITHM=INPLACE, LOCK=NONE) so a concurrently INSERTING seeder is not
 * blocked, same pattern as db/add-indexes-r21.ts.
 *
 * Run:  npx tsx db/add-indexes-r22.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const INDEXES: { name: string; columns: string }[] = [
  { name: "idx_explore_addedby", columns: "(addedById)" },
];

async function indexExists(db: ReturnType<typeof getDb>, name: string): Promise<boolean> {
  const [rows] = await db.execute(
    sql`SELECT COUNT(*) AS c FROM information_schema.statistics
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'explore_places' AND INDEX_NAME = ${name}`,
  );
  const c = Number((rows as unknown as { c: number }[])[0]?.c ?? 0);
  return c > 0;
}

async function main() {
  const db = getDb();
  for (const idx of INDEXES) {
    if (await indexExists(db, idx.name)) {
      console.log(`add-indexes-r22: ${idx.name} already exists, skipping`);
      continue;
    }
    const t0 = Date.now();
    try {
      await db.execute(
        sql.raw(`ALTER TABLE explore_places ADD INDEX ${idx.name} ${idx.columns}, ALGORITHM=INPLACE, LOCK=NONE`),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Duplicate key name|already exists/i.test(msg)) {
        console.log(`add-indexes-r22: ${idx.name} already exists (idempotent no-op)`);
        continue;
      }
      console.log(`add-indexes-r22: INPLACE/LOCK clauses rejected (${msg}); retrying plain ADD INDEX`);
      await db.execute(sql.raw(`ALTER TABLE explore_places ADD INDEX ${idx.name} ${idx.columns}`));
    }
    console.log(`add-indexes-r22: ${idx.name} ${idx.columns} added in ${Date.now() - t0}ms`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("add-indexes-r22 failed:", e);
  process.exit(1);
});
