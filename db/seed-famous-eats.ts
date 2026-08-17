/**
 * seed-famous-eats.ts - backfills explore_places.famousEatery for every
 * corpus city, using the deterministic rule in api/lib/famous-eats.ts
 * (verdict='must-see' OR top 8% by rating with min 4.3, cap 15/city).
 *
 * Pure DB work: no external calls. Batched by (city, country); progress
 * checkpoints to api_cache ('seed:famous-eats:checkpoint') after every city
 * so a sandbox restart resumes where it left off. Re-runs recompute and only
 * write rows whose flag actually changed (idempotent).
 *
 * Run:    npx tsx db/seed-famous-eats.ts                # full backfill
 *         npx tsx db/seed-famous-eats.ts --city Kyoto   # one city
 *         npx tsx db/seed-famous-eats.ts --reset        # ignore checkpoint
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "./schema";
import { getDb } from "../api/queries/connection";
import { cacheGet, cacheSet } from "../api/queries/coverage";
import { pickFamousEateries } from "../api/lib/famous-eats";

const CHECKPOINT_KEY = "seed:famous-eats:checkpoint";
const CHECKPOINT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHUNK = 200;

interface CityRow {
  city: string;
  country: string;
  n: number;
}

interface Checkpoint {
  idx: number; // last completed work-list index
  flagged: number; // running total of famous eateries
  updatedAt: string;
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const db = getDb();
  const onlyCity = arg("--city");
  const reset = process.argv.includes("--reset");

  const cityRows = await db
    .select({
      city: schema.explorePlaces.city,
      country: schema.explorePlaces.country,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.category, "food"))
    .groupBy(schema.explorePlaces.city, schema.explorePlaces.country)
    .orderBy(sql`count(*) DESC`);

  let work: CityRow[] = cityRows;
  if (onlyCity) work = work.filter((r) => r.city.toLowerCase() === onlyCity.toLowerCase());
  console.log(`seed-famous-eats: ${work.length} food cities to process`);

  let startIdx = 0;
  let flaggedTotal = 0;
  if (!reset && !onlyCity) {
    const cp = await cacheGet<Checkpoint>(CHECKPOINT_KEY);
    if (cp) {
      startIdx = cp.idx + 1;
      flaggedTotal = cp.flagged;
      console.log(`seed-famous-eats: resuming at city #${startIdx} (flagged so far ${flaggedTotal})`);
    }
  }

  for (let i = startIdx; i < work.length; i++) {
    const { city, country } = work[i];
    const rows = await db
      .select({
        id: schema.explorePlaces.id,
        rating: schema.explorePlaces.rating,
        verdict: schema.explorePlaces.verdict,
        // Quality-signal fallback for cities with no genuinely-rated eateries
        // (see pickFamousEateries step 2b).
        photoSource: schema.explorePlaces.photoSource,
        descriptionSource: schema.explorePlaces.descriptionSource,
        famousEatery: schema.explorePlaces.famousEatery,
      })
      .from(schema.explorePlaces)
      .where(
        and(
          eq(schema.explorePlaces.category, "food"),
          eq(schema.explorePlaces.city, city),
          eq(schema.explorePlaces.country, country),
        ),
      );

    const famous = pickFamousEateries(rows);
    const toFlag = rows.filter((r) => famous.has(r.id) && !r.famousEatery).map((r) => r.id);
    const toUnflag = rows.filter((r) => !famous.has(r.id) && r.famousEatery).map((r) => r.id);

    for (let j = 0; j < toFlag.length; j += CHUNK) {
      await db
        .update(schema.explorePlaces)
        .set({ famousEatery: true })
        .where(inArray(schema.explorePlaces.id, toFlag.slice(j, j + CHUNK)));
    }
    for (let j = 0; j < toUnflag.length; j += CHUNK) {
      await db
        .update(schema.explorePlaces)
        .set({ famousEatery: false })
        .where(inArray(schema.explorePlaces.id, toUnflag.slice(j, j + CHUNK)));
    }

    flaggedTotal += famous.size;
    console.log(
      `  [${i + 1}/${work.length}] ${city}, ${country}: ${rows.length} food → ${famous.size} famous` +
        (toFlag.length || toUnflag.length ? ` (+${toFlag.length}/-${toUnflag.length})` : " (unchanged)"),
    );

    await cacheSet(
      CHECKPOINT_KEY,
      { idx: i, flagged: flaggedTotal, updatedAt: new Date().toISOString() } satisfies Checkpoint,
      CHECKPOINT_TTL_MS,
    );
  }

  const totals = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.famousEatery, true));
  console.log(`seed-famous-eats: done, ${totals[0].n} famous eateries corpus-wide`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("seed-famous-eats failed:", e);
    process.exit(1);
  });
