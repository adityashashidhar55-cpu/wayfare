/**
 * Getaways top-up seeder (r16-getaways-topup) - the r14 cities seeder
 * (db/seed-getaways-cities.ts) covered the then-top-100 corpus cities; since
 * then the France + Germany corpus waves added 18 NEW cities with no getaway
 * rows. This seeder runs the EXACT same pipeline for that fixed list:
 *
 *   1. Overpass getaway scan - peaks/volcanoes/hot springs/caves,
 *      waterfalls, viewpoints, nature reserves, forts/ruins and hiking
 *      routes as 2×2 quadrant queries (fetchGetawayElements; mirrors rotate,
 *      429/5xx back off, quadrants pace 1.5 s apart, ≥2 s between cities).
 *   2. Filter + dedupe - unnamed/unpositioned dropped, <12 km from the city
 *      center dropped (city sights, not getaways), generic placeholder names
 *      dropped (isGenericName), then osmId + normalized-name dedupe against
 *      the existing corpus and within the batch. Rows insert exactly like
 *      the r14 seeder (source 'osm', rating 4.3, getaway styles).
 *   3. Cache warming - computes the getaways.near response for the city
 *      (OSRM table drive times for the top candidates, 7 d per-leg cache)
 *      and stores it under the v2 key `getaways:v2:near:<city>:150`
 *      (nearCacheKeyFor - do NOT hand-roll v1 keys) for 30 days, so the
 *      first real visitor gets an instant, external-HTTP-free answer. The
 *      24 h `getaway:{city}` enrichment marker is set too.
 *
 * RESUMABLE: progress lives in api_cache under 'seed:getaways-topup'
 * ({done: ["City|Country", …], failed, inserted, updatedAt}), written after
 * EVERY city, so a restart (sandbox wipes local files) skips completed
 * cities. Run with RESET=1 to start over. A failed city is logged and the
 * run CONTINUES, never aborts; a resumed run retries it.
 *
 * Run:            npx tsx db/seed-getaways-topup.ts
 * Background:     nohup npx tsx db/seed-getaways-topup.ts > /tmp/seed-topup.log 2>&1 &
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../api/queries/connection";
import { kmBetween, radiusBbox, sleep } from "../api/queries/coverage";
import { cacheGet, cacheKey, cacheSet } from "../api/lib/cache";
import { isGenericName } from "../api/lib/place-quality";
import {
  NEAR_CACHE_TTL_MS,
  nearCacheKeyFor,
  SEED_CHECKPOINT_TTL_MS,
  CITY_SIGHT_KM,
} from "../api/lib/getaways-shared";
import {
  computeGetawaysNearForAnchor,
  fetchGetawayElements,
  normalizeGetawayElement,
} from "../api/getaways-router";

type ExplorePlaceInsert = typeof schema.explorePlaces.$inferInsert;

/** Checkpoint key in api_cache - resume-safe across sandbox wipes. */
const TOPUP_PROGRESS_KEY = "seed:getaways-topup";
/** Overpass scan radius for the seeder's own <12 km/≤150 km filter. */
const SCAN_RADIUS_KM = 150;
/** Polite pacing between cities (quadrants pace themselves 1.5 s apart; with
 *  per-query latency this keeps ≥2 s between consecutive Overpass calls). */
const BETWEEN_CITIES_MS = 3_000;

interface CityRow {
  city: string;
  country: string;
  lat: number;
  lng: number;
}

/**
 * The 18 corpus cities added by the France + Germany waves that have NO
 * getaway rows yet. Names match the corpus exactly (near() cache keys and
 * inserted rows use them verbatim); coords are the city centers.
 */
const CITIES: CityRow[] = [
  // France wave
  { city: "Lyon", country: "France", lat: 45.764, lng: 4.835 },
  { city: "Marseille", country: "France", lat: 43.297, lng: 5.37 },
  { city: "Nice", country: "France", lat: 43.71, lng: 7.262 },
  { city: "Bordeaux", country: "France", lat: 44.838, lng: -0.579 },
  { city: "Strasbourg", country: "France", lat: 48.573, lng: 7.752 },
  { city: "Toulouse", country: "France", lat: 43.605, lng: 1.444 },
  { city: "Nantes", country: "France", lat: 47.218, lng: -1.554 },
  { city: "Lille", country: "France", lat: 50.629, lng: 3.057 },
  { city: "Montpellier", country: "France", lat: 43.611, lng: 3.877 },
  // Germany wave
  { city: "Hamburg", country: "Germany", lat: 53.551, lng: 9.993 },
  { city: "Cologne", country: "Germany", lat: 50.938, lng: 6.96 },
  { city: "Frankfurt", country: "Germany", lat: 50.11, lng: 8.682 },
  { city: "Dresden", country: "Germany", lat: 51.05, lng: 13.737 },
  { city: "Stuttgart", country: "Germany", lat: 48.776, lng: 9.183 },
  { city: "Leipzig", country: "Germany", lat: 51.34, lng: 12.375 },
  { city: "Nuremberg", country: "Germany", lat: 49.452, lng: 11.077 },
  { city: "Heidelberg", country: "Germany", lat: 49.399, lng: 8.672 },
  { city: "Düsseldorf", country: "Germany", lat: 51.227, lng: 6.773 },
];

interface Checkpoint {
  /** "City|Country" keys completed (success or no-candidates) */
  done: string[];
  failed: string[];
  inserted: number;
  updatedAt: string;
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const cityKey = (c: CityRow) => `${c.city}|${c.country}`;

/** One city's getaway scan + insert. Returns rows inserted. */
async function seedCity(c: CityRow): Promise<{ fetched: number; inserted: number }> {
  const db = getDb();
  const elements = await fetchGetawayElements(c.lat, c.lng);

  // Dedupe targets: everything the corpus already holds in the scan bbox.
  const b = radiusBbox(c.lat, c.lng, SCAN_RADIUS_KM);
  const existing = await db
    .select({ name: schema.explorePlaces.name, osmId: schema.explorePlaces.osmId })
    .from(schema.explorePlaces)
    .where(sql`${schema.explorePlaces.lat} BETWEEN ${b.s} AND ${b.n}
      AND ${schema.explorePlaces.lng} BETWEEN ${b.w} AND ${b.e}`);
  const existingOsmIds = new Set(existing.map((r) => r.osmId).filter((v): v is string => v != null));
  const existingNames = new Set(existing.map((r) => normName(r.name)));

  const rows: ExplorePlaceInsert[] = [];
  const batchOsmIds = new Set<string>();
  for (const el of elements) {
    const row = normalizeGetawayElement(el, c.city, c.country);
    if (!row) continue;
    // <12 km from the center = a city sight, not a getaway; >150 km = noise
    // from the bbox corners.
    const distKm = kmBetween(c.lat, c.lng, row.lat as number, row.lng as number);
    if (distKm < CITY_SIGHT_KM || distKm > SCAN_RADIUS_KM) continue;
    if (isGenericName(row.name)) continue;
    const osmId = row.osmId as string;
    if (existingOsmIds.has(osmId) || batchOsmIds.has(osmId)) continue;
    const nameKey = normName(row.name);
    if (existingNames.has(nameKey)) continue;
    batchOsmIds.add(osmId);
    existingNames.add(nameKey);
    rows.push(row);
  }
  for (let i = 0; i < rows.length; i += 50) {
    await db.insert(schema.explorePlaces).values(rows.slice(i, i + 50));
  }
  return { fetched: elements.length, inserted: rows.length };
}

/** Warm the 30-day near() response cache + the 24 h enrichment marker. */
async function warmCityCache(c: CityRow, enrich: { fetched: number; inserted: number }): Promise<void> {
  // 24 h marker - a live near({city}) won't re-run the Overpass pass we just did.
  await cacheSet(cacheKey("getaway:", normName(c.city)), enrich, 24 * 60 * 60 * 1000);
  // 30-day full response (OSRM legs get their own 7 d cache inside). v2 key
  // via nearCacheKeyFor - matches what the live getaways.near handler reads.
  const key = nearCacheKeyFor({ city: c.city, radiusKm: 150 });
  const hit = await cacheGet(key);
  if (hit) return; // already warm - don't burn OSRM quota
  const result = await computeGetawaysNearForAnchor(
    { city: c.city, lat: c.lat, lng: c.lng },
    { radiusKm: 150, limit: 24 },
  );
  await cacheSet(key, { ...result, cachedAt: new Date().toISOString() }, NEAR_CACHE_TTL_MS);
}

const startedAt = Date.now();
console.log(`[seed-getaways-topup] ${CITIES.length} fixed cities (France + Germany waves)`);

if (process.env.RESET === "1") {
  await cacheSet(
    TOPUP_PROGRESS_KEY,
    { done: [], failed: [], inserted: 0, updatedAt: new Date().toISOString() },
    SEED_CHECKPOINT_TTL_MS,
  );
  console.log("[seed-getaways-topup] RESET=1, checkpoint cleared");
}

const checkpoint = (await cacheGet<Checkpoint>(TOPUP_PROGRESS_KEY)) ?? {
  done: [],
  failed: [],
  inserted: 0,
  updatedAt: new Date().toISOString(),
};

console.log(
  `[seed-getaways-topup] ${checkpoint.done.length}/${CITIES.length} already done, resuming`,
);

let completedThisRun = 0;
for (const c of CITIES) {
  const key = cityKey(c);
  if (checkpoint.done.includes(key)) continue;
  try {
    const enrich = await seedCity(c);
    await warmCityCache(c, enrich);
    checkpoint.inserted += enrich.inserted;
    checkpoint.done.push(key);
    completedThisRun++;
    console.log(
      `[seed-getaways-topup] ${c.city}, ${c.country}, fetched ${enrich.fetched}, inserted +${enrich.inserted} [done ${checkpoint.done.length}/${CITIES.length}]`,
    );
  } catch (e) {
    // NOT marked done - a resumed run retries it (failures are usually
    // transient Overpass outages); it's recorded once in failed[] for the log.
    if (!checkpoint.failed.includes(key)) checkpoint.failed.push(key);
    console.error(
      `[seed-getaways-topup] ${c.city}, ${c.country} · FAILED: ${e instanceof Error ? e.message : e}`,
    );
  }
  checkpoint.updatedAt = new Date().toISOString();
  await cacheSet(TOPUP_PROGRESS_KEY, checkpoint, SEED_CHECKPOINT_TTL_MS);
  await sleep(BETWEEN_CITIES_MS);
}

console.log(
  `[seed-getaways-topup] DONE in ${((Date.now() - startedAt) / 1000).toFixed(0)}s, ` +
    `${completedThisRun} cities this run, ${checkpoint.done.length}/${CITIES.length} total, ` +
    `+${checkpoint.inserted} getaways inserted, ${checkpoint.failed.length} failed`,
);
process.exit(0);
