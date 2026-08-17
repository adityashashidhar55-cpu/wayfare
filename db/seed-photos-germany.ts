/**
 * seed-photos-germany.ts (r16-germany) - photo backfill for the German
 * corpus, a country-filtered wrapper around the db/seed-photos.ts engine
 * (r13 pattern: Wikipedia REST primary, DBpedia SPARQL fallback when
 * wikimedia is unreachable; positive+negative 30d caching in api_cache).
 *
 * Target set: ALL German explore_places rows needing a photo (image NULL or
 * a shared local "/…" stock placeholder) with a non-generic name.
 *
 * Priority order (r16 mission): must-see → famousEatery (★) → getaways
 * (rows outside the 12 km city-sight band of their city centroid, i.e.
 * getaway-band candidates per api/lib/getaways-shared.ts) → top-rated.
 *
 * Own checkpoint (`seed:photos:germany:checkpoint`) so it can run beside
 * the global seeder; per-city hit counts reported at the end.
 * Idempotent: rows already holding an external (http) image are untouched.
 *
 * Run:  npx tsx db/seed-photos-germany.ts [--restart]
 */
import { and, asc, eq, isNull, like, or } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet } from "../api/lib/cache";
import { isGenericName } from "../api/lib/place-quality";
import { kmBetween, CITY_SIGHT_KM } from "../api/lib/getaways-shared";
import {
  dbpediaPhotosForBatch,
  wikiPhotoForPlace,
  wikipediaReachable,
} from "./seed-photos";

const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 300;
const BATCH_WIKI = 20;
/** DBpedia is slow + flaky from the sandbox (intermittent 502 "under
 * maintenance" proxy pages) - smaller VALUES queries and retry with backoff. */
const BATCH_DBPEDIA = 8;
const DBPEDIA_RETRIES = 5;
const CHECKPOINT_KEY = "seed:photos:germany:checkpoint";
const RESTART = process.argv.includes("--restart");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: number;
  name: string;
  city: string;
  lat: number | null;
  lng: number | null;
  verdict: string | null;
  famousEatery: boolean;
  rating: number | null;
}

interface Checkpoint {
  lastIdx: number; // positional index into the ordered work list
  orderHash: string; // resume only when the ordered id list is unchanged
  hits: number;
  misses: number;
  errors: number;
  perCity: Record<string, { hits: number; misses: number }>;
  updatedAt: string;
}

async function main() {
  const db = getDb();
  const useWikipedia = await wikipediaReachable();
  console.log(
    `[seed-photos-de] backend: ${useWikipedia ? "Wikipedia REST v1" : "DBpedia SPARQL (Wikipedia unreachable)"}`,
  );

  const needsImage = or(
    isNull(schema.explorePlaces.image),
    like(schema.explorePlaces.image, "/%"),
  );
  const rows = (
    await db
      .select({
        id: schema.explorePlaces.id,
        name: schema.explorePlaces.name,
        city: schema.explorePlaces.city,
        lat: schema.explorePlaces.lat,
        lng: schema.explorePlaces.lng,
        verdict: schema.explorePlaces.verdict,
        famousEatery: schema.explorePlaces.famousEatery,
        rating: schema.explorePlaces.rating,
      })
      .from(schema.explorePlaces)
      .where(and(eq(schema.explorePlaces.country, "Germany"), needsImage))
      .orderBy(asc(schema.explorePlaces.id))
  ).map((r) => ({ ...r, id: Number(r.id) })) as Row[];

  // City centroids for the getaway-band tier.
  const byCity = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byCity.get(r.city) ?? [];
    list.push(r);
    byCity.set(r.city, list);
  }
  const centroids = new Map<string, { lat: number; lng: number }>();
  for (const [city, list] of byCity) {
    const pts = list.filter((r) => r.lat != null && r.lng != null);
    if (pts.length) {
      centroids.set(city, {
        lat: pts.reduce((s, r) => s + r.lat!, 0) / pts.length,
        lng: pts.reduce((s, r) => s + r.lng!, 0) / pts.length,
      });
    }
  }

  // Priority: must-see → famousEatery → getaway-band → top-rated.
  const tierOf = (r: Row): number => {
    if (r.verdict === "must-see") return 0;
    if (r.famousEatery) return 1;
    const c = centroids.get(r.city);
    if (c && r.lat != null && r.lng != null && kmBetween(r.lat, r.lng, c.lat, c.lng) >= CITY_SIGHT_KM)
      return 2;
    return 3;
  };
  rows.sort((a, b) => tierOf(a) - tierOf(b) || (b.rating ?? 0) - (a.rating ?? 0) || a.id - b.id);
  const orderHash = rows.map((r) => r.id).join(",");

  let cp: Checkpoint = (!RESTART && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || null!;
  if (!cp || cp.orderHash !== orderHash) {
    if (cp) console.log("[seed-photos-de] work list changed since checkpoint, starting over");
    cp = { lastIdx: -1, orderHash, hits: 0, misses: 0, errors: 0, perCity: {}, updatedAt: "" };
  } else if (cp.lastIdx >= 0) {
    console.log(
      `[seed-photos-de] resuming at ${cp.lastIdx + 1}/${rows.length} (hits ${cp.hits}, misses ${cp.misses})`,
    );
  }
  console.log(`[seed-photos-de] targets: ${rows.length} German image-less rows`);

  const bump = (city: string, field: "hits" | "misses") => {
    (cp.perCity[city] ??= { hits: 0, misses: 0 })[field] += 1;
  };

  const batchSize = useWikipedia ? BATCH_WIKI : BATCH_DBPEDIA;
  let processed = 0;
  let consecutiveErrors = 0;
  for (let i = cp.lastIdx + 1; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const started = Date.now();
    try {
      if (useWikipedia) {
        for (let j = 0; j < batch.length; j++) {
          const place = batch[j]!;
          cp.lastIdx = i + j; // batch is rows.slice(i, i + BATCH)
          if (isGenericName(place.name)) continue;
          const oneStart = Date.now();
          try {
            const { hit, fromCache } = await wikiPhotoForPlace(place.name, place.city);
            consecutiveErrors = 0;
            if (hit) {
              await db
                .update(schema.explorePlaces)
                .set({ image: hit.image, photoSource: "wikipedia", photoAttribution: hit.attribution })
                .where(eq(schema.explorePlaces.id, place.id));
              cp.hits++;
              bump(place.city, "hits");
            } else {
              cp.misses++;
              bump(place.city, "misses");
            }
            if (!fromCache) {
              const elapsed = Date.now() - oneStart;
              if (elapsed < THROTTLE_MS) await sleep(THROTTLE_MS - elapsed);
            }
          } catch (e) {
            cp.errors++;
            consecutiveErrors++;
            console.warn(
              `[seed-photos-de] lookup error for "${place.name}" (${place.city}): ${e instanceof Error ? e.message : e}`,
            );
            await sleep(1500);
          }
          processed++;
          if (processed % 50 === 0) {
            console.log(
              `[seed-photos-de] ${cp.lastIdx + 1}/${rows.length}, hits ${cp.hits}, misses ${cp.misses}, errors ${cp.errors}`,
            );
          }
        }
      } else {
        const eligible = batch.filter((p) => !isGenericName(p.name));
        let found: Awaited<ReturnType<typeof dbpediaPhotosForBatch>> | null = null;
        for (let attempt = 1; attempt <= DBPEDIA_RETRIES; attempt++) {
          try {
            found = await dbpediaPhotosForBatch(eligible);
            break;
          } catch (e) {
            const wait = attempt * 8000;
            console.warn(
              `[seed-photos-de] dbpedia attempt ${attempt}/${DBPEDIA_RETRIES} failed at idx ${i}: ${e instanceof Error ? e.message : e}, retrying in ${wait / 1000}s`,
            );
            await sleep(wait);
          }
        }
        if (!found) throw new Error("dbpedia retries exhausted");
        consecutiveErrors = 0;
        for (let j = 0; j < batch.length; j++) {
          const place = batch[j]!;
          cp.lastIdx = i + j;
          const hit = found.get(place.id);
          if (hit) {
            await db
              .update(schema.explorePlaces)
              .set({ image: hit.image, photoSource: "wikipedia", photoAttribution: hit.attribution })
              .where(eq(schema.explorePlaces.id, place.id));
            cp.hits++;
            bump(place.city, "hits");
          } else if (!isGenericName(place.name)) {
            cp.misses++;
            bump(place.city, "misses");
          }
          processed++;
        }
        const elapsed = Date.now() - started;
        if (elapsed < THROTTLE_MS) await sleep(THROTTLE_MS - elapsed);
      }
    } catch (e) {
      cp.errors += 1;
      consecutiveErrors++;
      console.warn(`[seed-photos-de] batch error at idx ${cp.lastIdx}: ${e instanceof Error ? e.message : e}`);
      await sleep(2000);
    }
    cp.updatedAt = new Date().toISOString();
    await cacheSet(CHECKPOINT_KEY, cp, TTL_30D);
    if (consecutiveErrors >= 8) {
      console.error("[seed-photos-de] too many consecutive errors, stopping (checkpoint saved; re-run to resume)");
      break;
    }
  }

  cp.updatedAt = new Date().toISOString();
  await cacheSet(CHECKPOINT_KEY, cp, TTL_30D);
  console.log(
    `\n[seed-photos-de] done: ${cp.hits} hits, ${cp.misses} misses (no Wikipedia photo), ${cp.errors} errors`,
  );
  for (const [city, c] of Object.entries(cp.perCity)) {
    console.log(`[seed-photos-de]   ${city}: ${c.hits} photos, ${c.misses} misses`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-photos-de] FAILED:", e);
  process.exit(1);
});
