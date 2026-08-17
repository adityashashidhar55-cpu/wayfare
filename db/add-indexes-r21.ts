/**
 * add-indexes-r21.ts (r21-perf) — idempotent index migration for explore_places.
 *
 * The table is 390k+ rows and had a single secondary index
 * (idx_explore_city_famous on city,country,famousEatery). Proximity/getaway
 * bbox scans and country/category filters were full table scans.
 *
 * Adds (one ALTER per index, TiDB allows a single alter action per statement):
 *   idx_explore_city     (city)      - city equality lookups (roadtrip, famous eats)
 *   idx_explore_country  (country)   - country filters
 *   idx_explore_category (category)  - category filters (food eats, getaway categories)
 *   idx_explore_latlng   (lat, lng)  - bbox proximity scans (getaways, near-me)
 *
 * No INDEX(name): the explore search uses leading-wildcard LIKE '%q%'
 * (api/explore-router.ts), which cannot use a B-tree index, so it would be
 * dead write overhead.
 *
 * IDEMPOTENT: checks information_schema.statistics before each ADD INDEX and
 * skips indexes that already exist. Uses ALGORITHM=INPLACE, LOCK=NONE so a
 * concurrently INSERTING seeder is not blocked (TiDB runs DDL online by
 * default; falls back to a plain ADD INDEX if the engine rejects the clauses).
 *
 * Run:  npx tsx db/add-indexes-r21.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const INDEXES: { name: string; columns: string }[] = [
  { name: "idx_explore_city", columns: "(city)" },
  { name: "idx_explore_country", columns: "(country)" },
  { name: "idx_explore_category", columns: "(category)" },
  { name: "idx_explore_latlng", columns: "(lat, lng)" },
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
      console.log(`add-indexes-r21: ${idx.name} already exists, skipping`);
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
        console.log(`add-indexes-r21: ${idx.name} already exists (idempotent no-op)`);
        continue;
      }
      if (/ALGORITHM|LOCK|syntax|unsupported/i.test(msg)) {
        // Engine rejected the online-DDL clauses; retry plain (TiDB DDL is online anyway).
        await db.execute(sql.raw(`ALTER TABLE explore_places ADD INDEX ${idx.name} ${idx.columns}`));
      } else {
        throw e;
      }
    }
    console.log(`add-indexes-r21: ${idx.name} ${idx.columns} added in ${Date.now() - t0}ms`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
