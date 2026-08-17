/**
 * seed-verdicts.ts - backfills explore_places.verdict for every row where it
 * is still NULL, using the heuristic in api/lib/verdict.ts (world-famous
 * table → UNESCO cues → top-rated iconic categories → low-rated generic
 * stops → worth-it).
 *
 * IDEMPOTENT: only rows with verdict IS NULL are touched, so re-runs are
 * no-ops and hand-set editorial verdicts are never overwritten. Updates are
 * batched (one UPDATE per verdict value per 200-row chunk) and counts are
 * logged per verdict.
 *
 * Run:  npx tsx db/seed-verdicts.ts
 */
import { inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { verdictFor, PLACE_VERDICTS, type PlaceVerdict } from "../api/lib/verdict";

const CHUNK = 200;

async function main() {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.explorePlaces.id,
      name: schema.explorePlaces.name,
      city: schema.explorePlaces.city,
      country: schema.explorePlaces.country,
      category: schema.explorePlaces.category,
      tags: schema.explorePlaces.tags,
      rating: schema.explorePlaces.rating,
      description: schema.explorePlaces.description,
    })
    .from(schema.explorePlaces)
    .where(isNull(schema.explorePlaces.verdict));

  console.log(`seed-verdicts: ${rows.length} places missing a verdict`);
  if (!rows.length) {
    console.log("seed-verdicts: nothing to do (idempotent re-run)");
  }

  const byVerdict = new Map<PlaceVerdict, number[]>();
  for (const v of PLACE_VERDICTS) byVerdict.set(v, []);
  for (const r of rows) {
    byVerdict.get(verdictFor(r))!.push(r.id);
  }

  let updated = 0;
  for (const [verdict, ids] of byVerdict) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      await db
        .update(schema.explorePlaces)
        .set({ verdict })
        .where(inArray(schema.explorePlaces.id, chunk));
      updated += chunk.length;
    }
    if (ids.length) console.log(`  ${verdict}: ${ids.length}`);
  }
  console.log(`seed-verdicts: updated ${updated} rows`);

  const totals = await db
    .select({
      verdict: schema.explorePlaces.verdict,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(schema.explorePlaces)
    .groupBy(schema.explorePlaces.verdict);
  console.log("seed-verdicts: corpus now →", totals.map((t) => `${t.verdict ?? "NULL"}=${t.n}`).join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("seed-verdicts failed:", e);
    process.exit(1);
  });
