/**
 * r25 — honest-data migration + the spatial index r21 promised and never shipped.
 *
 * Run:  npx tsx db/migrate-r25-honest-data.ts            (dry run, reports only)
 *       npx tsx db/migrate-r25-honest-data.ts --apply    (writes)
 *
 * WHAT THIS FIXES
 *
 * 1. Fabricated ratings. api/queries/overpass.ts and coverage.ts used to write
 *    `rating: 4.3, priceLevel: 2` onto EVERY place imported from OSM (~442k
 *    rows per seed-world-r17.log). The UI rendered that as a filled gold star,
 *    indistinguishable from a real crowd rating; api/lib/explore-feed.ts ranked
 *    with weight `2 * rating`; and api/lib/famous-eats.ts thresholded its
 *    "★ Famous pick" badge at >= 4.3 — exactly the import default — so the
 *    badge degenerated into "first N by row id".
 *
 *    The importers now write NULL. This nulls the historical rows so the corpus
 *    matches. We only touch rows that carry the exact import signature
 *    (source = 'osm' AND rating = 4.3), so genuinely-rated curated rows and any
 *    place that coincidentally scored 4.3 from a real source are left alone.
 *
 * 2. Missing (lat,lng) index. plan-r21.md committed to "add city / country /
 *    (lat,lng) / category indexes". The city/country one shipped; the spatial
 *    one did not. Every bbox query in explore-router (nearby, discoverArea,
 *    nearbyFood, matchPricesToStops) therefore range-scans the whole corpus —
 *    i.e. every map interaction full-scans 442k rows.
 *
 * SAFETY
 * - Dry run by default. Nothing is written without --apply.
 * - Every statement is idempotent: re-running is a no-op.
 * - Index creation is guarded on information_schema, so it won't error if the
 *   index already exists.
 * - AFTER APPLYING: re-run `npx tsx db/seed-famous-eats.ts` to recompute the
 *   famousEatery flags, which were derived from the numbers this script nulls.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const APPLY = process.argv.includes("--apply");

/** The exact values the OSM importers used to hardcode. */
const FABRICATED_RATING = 4.3;
const FABRICATED_PRICE_LEVEL = 2;

function log(...args: unknown[]) {
  console.log("[r25]", ...args);
}

/**
 * getDb() is drizzle-orm/mysql2 (the `mode: "planetscale"` flag in
 * queries/connection.ts is a dialect-compat setting, NOT the PlanetScale HTTP
 * driver). So db.execute() resolves to the raw mysql2 tuple
 * [rows | ResultSetHeader, FieldPacket[]] -- results live at [0], and the
 * write-count field is `affectedRows`, not `rowsAffected`. Getting this wrong
 * makes the chunk loops below exit after a single batch while reporting
 * success. Matches the unwrap in db/audit-france-locations.ts:126.
 */
function head(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** First scalar column `n` of a COUNT(*) query. */
function countOf(raw: unknown): number {
  const rows = head(raw) as Array<Record<string, unknown>> | undefined;
  return Number(rows?.[0]?.n ?? 0);
}

/** Rows written by an UPDATE/DELETE. Returns -1 when the driver didn't say. */
function affected(raw: unknown): number {
  const header = head(raw) as { affectedRows?: number } | undefined;
  const n = header?.affectedRows;
  return typeof n === "number" ? n : -1;
}

async function countFabricated(db: ReturnType<typeof getDb>) {
  const rated = await db.execute(
    sql`SELECT COUNT(*) AS n FROM explore_places
        WHERE source = 'osm' AND rating = ${FABRICATED_RATING}`,
  );
  const priced = await db.execute(
    sql`SELECT COUNT(*) AS n FROM explore_places
        WHERE source = 'osm' AND priceLevel = ${FABRICATED_PRICE_LEVEL}`,
  );
  const total = await db.execute(sql`SELECT COUNT(*) AS n FROM explore_places`);
  return { rated: countOf(rated), priced: countOf(priced), total: countOf(total) };
}

async function hasIndex(db: ReturnType<typeof getDb>, table: string, name: string) {
  const rows = await db.execute(
    sql`SELECT COUNT(*) AS n FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ${table} AND index_name = ${name}`,
  );
  return countOf(rows) > 0;
}

/**
 * Nulls one fabricated column in chunks. Returns the number of rows changed.
 *
 * The loop terminates on a re-COUNT of remaining rows rather than trusting the
 * driver's affected-row count, so a driver that doesn't report it can't cause
 * either an early exit (silently migrating one batch of 442k) or an infinite
 * loop. The count strictly decreases every iteration or we stop.
 */
async function nullColumnInChunks(
  db: ReturnType<typeof getDb>,
  column: "rating" | "priceLevel",
  fabricatedValue: number,
  chunk: number,
): Promise<number> {
  const col = sql.identifier(column);
  const remaining = async () =>
    countOf(
      await db.execute(
        sql`SELECT COUNT(*) AS n FROM explore_places
            WHERE source = 'osm' AND ${col} = ${fabricatedValue}`,
      ),
    );

  let left = await remaining();
  const startedWith = left;
  let guard = 0;

  while (left > 0) {
    const res = await db.execute(
      sql`UPDATE explore_places SET ${col} = NULL
          WHERE source = 'osm' AND ${col} = ${fabricatedValue}
          LIMIT ${chunk}`,
    );
    const wrote = affected(res);
    const before = left;
    left = await remaining();

    if (left >= before) {
      // No progress: the UPDATE isn't matching what the COUNT matches. Stop
      // rather than spin forever.
      log(`  !! ${column}: no progress (${before} -> ${left}), stopping early`);
      break;
    }
    log(
      `  ...${column}: ${(startedWith - left).toLocaleString()} / ${startedWith.toLocaleString()}` +
        (wrote >= 0 ? ` (last batch ${wrote.toLocaleString()})` : ""),
    );
    if (++guard > 1000) {
      log(`  !! ${column}: chunk guard tripped, stopping`);
      break;
    }
  }
  return startedWith - left;
}

async function main() {
  const db = getDb();

  log(APPLY ? "APPLY mode — writing changes." : "DRY RUN — no writes. Pass --apply to commit.");

  // ── 1. Report ────────────────────────────────────────────────────────────
  const before = await countFabricated(db);
  log(`corpus: ${before.total.toLocaleString()} places`);
  log(`  fabricated rating (osm, = ${FABRICATED_RATING}):     ${before.rated.toLocaleString()}`);
  log(`  fabricated priceLevel (osm, = ${FABRICATED_PRICE_LEVEL}): ${before.priced.toLocaleString()}`);

  // ── 2. Null the fabricated values ────────────────────────────────────────
  if (APPLY) {
    // Chunked so a 400k-row UPDATE doesn't hold one enormous transaction.
    const CHUNK = 20_000;
    const cleared = await nullColumnInChunks(db, "rating", FABRICATED_RATING, CHUNK);
    const clearedPrice = await nullColumnInChunks(db, "priceLevel", FABRICATED_PRICE_LEVEL, CHUNK);
    log(`nulled ${cleared.toLocaleString()} ratings, ${clearedPrice.toLocaleString()} price levels`);

    const after = await countFabricated(db);
    if (after.rated || after.priced) {
      log(`WARNING: ${after.rated} ratings and ${after.priced} price levels still fabricated — re-run.`);
    } else {
      log("verified: no fabricated ratings or price levels remain");
    }
  } else {
    log(`would null ${before.rated.toLocaleString()} ratings and ${before.priced.toLocaleString()} price levels`);
  }

  // ── 3. Drop the column defaults so new rows can't reintroduce the problem ─
  if (APPLY) {
    try {
      await db.execute(sql`ALTER TABLE explore_places ALTER COLUMN rating DROP DEFAULT`);
      await db.execute(sql`ALTER TABLE explore_places ALTER COLUMN priceLevel DROP DEFAULT`);
      log("dropped column defaults on rating / priceLevel");
    } catch (e) {
      log("could not drop column defaults (may already be dropped):", (e as Error).message);
    }
  }

  // ── 4. The (lat,lng) index ───────────────────────────────────────────────
  const IDX = "idx_explore_latlng";
  const exists = await hasIndex(db, "explore_places", IDX);
  if (exists) {
    log(`${IDX} already present`);
  } else if (APPLY) {
    log(`creating ${IDX} — this can take several minutes on a ${before.total.toLocaleString()}-row table`);
    try {
      await db.execute(sql`CREATE INDEX ${sql.identifier(IDX)} ON explore_places (lat, lng)`);
      log(`${IDX} created`);
    } catch (e) {
      // ER_DUP_KEYNAME if a previous run got this far — idempotent by contract.
      log(`${IDX} not created: ${(e as Error).message}`);
    }
  } else {
    log(`would create ${IDX} on explore_places (lat, lng)`);
  }

  // A composite that serves the very common "food places near here" query
  // (nearbyFood) without falling back to the plain lat/lng scan.
  const IDX2 = "idx_explore_cat_latlng";
  const exists2 = await hasIndex(db, "explore_places", IDX2);
  if (exists2) {
    log(`${IDX2} already present`);
  } else if (APPLY) {
    try {
      await db.execute(sql`CREATE INDEX ${sql.identifier(IDX2)} ON explore_places (category, lat, lng)`);
      log(`${IDX2} created`);
    } catch (e) {
      log(`${IDX2} not created: ${(e as Error).message}`);
    }
  } else {
    log(`would create ${IDX2} on explore_places (category, lat, lng)`);
  }

  if (APPLY) {
    log("");
    log("NEXT: run `npx tsx db/seed-famous-eats.ts` to recompute the ★ Famous");
    log("      pick flags — the old ones were derived from the 4.3 constant.");
  }

  log("done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[r25] FAILED", e);
  process.exit(1);
});
