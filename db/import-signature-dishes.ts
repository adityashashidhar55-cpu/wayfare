/**
 * import-signature-dishes.ts - loads every db/data/signature-dishes-*.json
 * into signature_dishes + signature_dish_places, linking each place to the
 * explore_places corpus.
 *
 * Idempotent per (city, country, dish): existing dish rows (and their places,
 * via FK cascade + explicit delete) are wiped and re-inserted. Each place is
 * matched to explore_places by normalized-name + haversine <1 km (same city);
 * unmatched places are INSERTed as curated corpus rows (category='food',
 * tags ['cafe']|['restaurant'], styles [], famousEatery=1, source='curated',
 * rating 4.4) so they surface in the regular food feeds too - and match on
 * the next run, so re-imports never duplicate corpus rows.
 *
 * Run:  npx tsx db/import-signature-dishes.ts [--dry-run]
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "./schema";
import { getDb } from "../api/queries/connection";
import {
  isCafeIsh,
  matchDishPlace,
  normalizePlaceName,
} from "../api/lib/signature-dishes";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const DRY_RUN = process.argv.includes("--dry-run");

interface DishFilePlace {
  name: string;
  lat?: number;
  lng?: number;
  why?: string;
}
interface DishFileEntry {
  city: string;
  country: string;
  dish: string;
  blurb?: string;
  places?: DishFilePlace[];
}

function loadEntries(): DishFileEntry[] {
  if (!existsSync(DATA_DIR)) return [];
  const files = readdirSync(DATA_DIR)
    .filter((f) => /^signature-dishes-.+\.json$/.test(f))
    .sort();
  const entries: DishFileEntry[] = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(path.join(DATA_DIR, f), "utf8"));
    if (!Array.isArray(raw)) {
      console.warn(`[import] ${f}: not an array, skipped`);
      continue;
    }
    for (const e of raw) {
      if (!e?.city || !e?.country || !e?.dish) {
        console.warn(`[import] ${f}: entry missing city/country/dish, skipped`);
        continue;
      }
      entries.push(e);
    }
    console.log(`[import] ${f}: ${raw.length} dish entr${raw.length === 1 ? "y" : "ies"}`);
  }
  return entries;
}

async function main() {
  const entries = loadEntries();
  if (!entries.length) {
    console.log("[import] no db/data/signature-dishes-*.json entries found");
    return;
  }
  const db = getDb();
  let dishes = 0;
  let matched = 0;
  let inserted = 0;
  let unmatchedNoGeo = 0;

  for (let pos = 0; pos < entries.length; pos++) {
    const e = entries[pos];
    const key = `${e.dish} · ${e.city}, ${e.country}`;

    // ── wipe existing rows for (city,country,dish) ──
    const existing = await db
      .select({ id: schema.signatureDishes.id })
      .from(schema.signatureDishes)
      .where(
        and(
          eq(schema.signatureDishes.city, e.city),
          eq(schema.signatureDishes.country, e.country),
          eq(schema.signatureDishes.dish, e.dish),
        ),
      );
    if (existing.length) {
      const ids = existing.map((r) => Number(r.id));
      if (!DRY_RUN) {
        await db
          .delete(schema.signatureDishPlaces)
          .where(inArray(schema.signatureDishPlaces.dishId, ids));
        await db.delete(schema.signatureDishes).where(inArray(schema.signatureDishes.id, ids));
      }
      console.log(`[import] ${key}: wiped ${existing.length} existing dish row(s)`);
    }

    // ── insert dish row ──
    let dishId = 0;
    if (!DRY_RUN) {
      const res = await db.insert(schema.signatureDishes).values({
        city: e.city,
        country: e.country,
        dish: e.dish,
        blurb: e.blurb ?? null,
        position: pos,
      });
      dishId = Number((res as unknown as [{ insertId: number | string }])[0].insertId);
    }
    dishes++;

    // ── corpus candidates for matching: food places in this city ──
    const corpus = await db
      .select({
        id: schema.explorePlaces.id,
        name: schema.explorePlaces.name,
        lat: schema.explorePlaces.lat,
        lng: schema.explorePlaces.lng,
      })
      .from(schema.explorePlaces)
      .where(
        and(
          eq(schema.explorePlaces.city, e.city),
          eq(schema.explorePlaces.country, e.country),
          eq(schema.explorePlaces.category, "food"),
          eq(schema.explorePlaces.approved, true),
        ),
      );
    const corpusTyped = corpus.map((c) => ({ ...c, id: Number(c.id) }));

    const places = e.places ?? [];
    for (let pPos = 0; pPos < places.length; pPos++) {
      const p = places[pPos];
      const hit = matchDishPlace(corpusTyped, p);
      let placeId: number | null = null;
      if (hit) {
        placeId = hit.place.id;
        matched++;
        if (!DRY_RUN) {
          await db
            .update(schema.explorePlaces)
            .set({ famousEatery: true })
            .where(eq(schema.explorePlaces.id, placeId));
        }
        console.log(
          `  ✓ matched "${p.name}" → #${placeId} "${hit.place.name}"` +
            (hit.distanceKm != null ? ` (${hit.distanceKm.toFixed(2)} km)` : ""),
        );
      } else if (p.lat != null && p.lng != null) {
        // insert curated corpus row so the place joins regular food feeds
        const tags = isCafeIsh(p.name, e.dish) ? ["cafe"] : ["restaurant"];
        if (!DRY_RUN) {
          const res = await db.insert(schema.explorePlaces).values({
            name: p.name.slice(0, 255),
            city: e.city,
            country: e.country,
            lat: p.lat,
            lng: p.lng,
            category: "food",
            tags,
            styles: [],
            rating: 4.4,
            famousEatery: true,
            source: "curated",
            description: p.why ?? null,
          });
          placeId = Number((res as unknown as [{ insertId: number | string }])[0].insertId);
          // include in subsequent matches within this run
          corpusTyped.push({ id: placeId, name: p.name, lat: p.lat, lng: p.lng });
        }
        inserted++;
        console.log(`  + inserted curated corpus place "${p.name}" (${tags[0]})`);
      } else {
        unmatchedNoGeo++;
        console.log(`  · no match & no coords, kept unlinked: "${p.name}"`);
      }

      if (!DRY_RUN) {
        await db.insert(schema.signatureDishPlaces).values({
          dishId,
          placeId,
          name: p.name.slice(0, 191),
          lat: p.lat ?? null,
          lng: p.lng ?? null,
          why: p.why?.slice(0, 255) ?? null,
          position: pPos,
        });
      }
    }
    console.log(`[import] ${key}: ${places.length} place(s)`);
  }

  // sanity: table counts
  const [d] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.signatureDishes);
  const [dp] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.signatureDishPlaces);
  console.log(
    `[import] done${DRY_RUN ? " (dry run)" : ""}: ${dishes} dishes · ` +
      `${matched} matched · ${inserted} inserted · ${unmatchedNoGeo} unlinked · ` +
      `totals: ${d.n} dishes / ${dp.n} dish-places`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[import] failed:", err);
  process.exit(1);
});
