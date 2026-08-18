/**
 * r28 - quality columns + the fabricated-rating cleanup, for an EXISTING db.
 *
 * Run:  npx tsx db/migrate-r28-quality.ts            (dry run)
 *       npx tsx db/migrate-r28-quality.ts --apply    (writes)
 *
 * A fresh database loaded from db/data/explore_places.mysql.sql.gz already has
 * all of this. This script exists for a database that was loaded earlier, or
 * for Kimi's own if it is ever reused.
 *
 * WHAT IT FIXES
 *
 * 1. rating = 4.3 on 525,457 OSM rows and priceLevel = 2 on the same rows.
 *    These are the import defaults, never real ratings. r25 fixed the
 *    importers going forward but the migration was never run against the live
 *    database, so the values are still there. Rendered, they are a gold star
 *    nobody gave. Scoped to source='osm' AND the exact default, so a genuine
 *    4.3 on a curated row is untouched.
 *
 * 2. Adds qualityScore / isChain / isJunk and their indexes.
 *
 * 3. Normalises "Pune, India" -> "Pune". explore.list matches city with eq(),
 *    so the suffixed rows were a separate, unreachable city.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const APPLY = process.argv.includes("--apply");
const log = (...a: unknown[]) => console.log("[r28]", ...a);

/**
 * getDb() is drizzle-orm/mysql2 - db.execute() resolves to the raw mysql2
 * tuple, so results live at [0] and the write count is `affectedRows`, not
 * `rowsAffected`. Same unwrap as db/audit-france-locations.ts:126.
 */
function head(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}
function affected(raw: unknown): number {
  const h = head(raw) as { affectedRows?: number } | undefined;
  return Number(h?.affectedRows ?? 0);
}

async function columnExists(name: string): Promise<boolean> {
  const rows = head(
    await getDb().execute(
      sql`SELECT COUNT(*) AS n FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'explore_places' AND column_name = ${name}`,
    ),
  ) as { n: number }[] | undefined;
  return Number(rows?.[0]?.n ?? 0) > 0;
}

async function main() {
  const db = getDb();
  log(APPLY ? "APPLYING" : "DRY RUN (pass --apply to write)");

  for (const [col, ddl] of [
    ["qualityScore", "ADD COLUMN qualityScore INT NOT NULL DEFAULT 0"],
    ["isChain", "ADD COLUMN isChain BOOLEAN NOT NULL DEFAULT 0"],
    ["isJunk", "ADD COLUMN isJunk BOOLEAN NOT NULL DEFAULT 0"],
  ] as const) {
    if (await columnExists(col)) { log(`${col}: exists`); continue; }
    if (!APPLY) { log(`${col}: WOULD ADD`); continue; }
    await db.execute(sql.raw(`ALTER TABLE explore_places ${ddl}`));
    log(`${col}: added`);
  }

  const counts = head(
    await db.execute(sql`SELECT
        SUM(source='osm' AND rating = 4.3) AS fakeRating,
        SUM(source='osm' AND priceLevel = 2) AS fakePrice,
        SUM(city LIKE CONCAT('%, ', country)) AS suffixedCity
      FROM explore_places`),
  ) as Record<string, number>[] | undefined;
  log("found:", JSON.stringify(counts?.[0] ?? {}));

  if (!APPLY) { log("dry run complete."); process.exit(0); }

  // Chunked so a 500k-row UPDATE never holds one enormous transaction.
  let total = 0;
  for (;;) {
    const n = affected(
      await db.execute(sql`UPDATE explore_places SET rating = NULL
        WHERE source = 'osm' AND rating = 4.3 LIMIT 20000`),
    );
    total += n;
    log(`  ratings nulled: ${total}`);
    if (n === 0) break;
  }
  let ptotal = 0;
  for (;;) {
    const n = affected(
      await db.execute(sql`UPDATE explore_places SET priceLevel = NULL
        WHERE source = 'osm' AND priceLevel = 2 LIMIT 20000`),
    );
    ptotal += n;
    log(`  priceLevels nulled: ${ptotal}`);
    if (n === 0) break;
  }
  const cityFixed = affected(
    await db.execute(sql`UPDATE explore_places
      SET city = TRIM(TRAILING CONCAT(', ', country) FROM city)
      WHERE city LIKE CONCAT('%, ', country)`),
  );
  log(`  city names normalised: ${cityFixed}`);

  for (const [name, cols] of [
    ["idx_explore_city_quality", "(city, qualityScore)"],
    ["idx_explore_quality", "(qualityScore)"],
  ] as const) {
    try { await db.execute(sql.raw(`CREATE INDEX ${name} ON explore_places ${cols}`)); log(`  index ${name} created`); }
    catch { log(`  index ${name} already present`); }
  }
  log("done. Re-run db/seed-famous-eats.ts - fame flags derived from the nulled ratings.");
  process.exit(0);
}

main().catch((e) => { console.error("[r28] failed", e); process.exit(1); });
