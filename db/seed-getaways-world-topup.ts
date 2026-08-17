/**
 * Getaways world top-up seeder (r17-sync) — after the world city seeder
 * (db/seed-world-cities.ts) reached COMPLETE, many NEW corpus cities have
 * ≥150 explore_places rows but no overnight-getaway coverage. This seeder
 * finds them dynamically and runs the EXACT same pipeline as the r14/r16
 * seeders (db/seed-getaways-cities.ts / db/seed-getaways-topup.ts):
 *
 *   City selection: every (city, country) in explore_places with ≥150
 *   approved rows whose normalized name has NO `getaway:<city>` marker AND
 *   no `getaways:v2:near:<city>:150` entry in api_cache — capped at the top
 *   80 by row count. Anchors come from the corpus centroid (AVG lat/lng),
 *   so NO Photon calls are needed.
 *
 *   Per city:
 *   1. Overpass getaway scan — peaks/volcanoes/hot springs/caves,
 *      waterfalls, viewpoints, nature reserves, forts/ruins and hiking
 *      routes as 2×2 quadrant queries (fetchGetawayElements; mirrors rotate,
 *      429/5xx back off, quadrants pace 1.5 s apart).
 *   2. Filter + dedupe — unnamed/unpositioned dropped, <12 km from the city
 *      center dropped (city sights, not getaways), generic placeholder names
 *      dropped (isGenericName), then osmId + normalized-name dedupe against
 *      the existing corpus and within the batch. Rows insert exactly like
 *      the r14 seeder (source 'osm', rating 4.3, getaway styles).
 *   3. Cache warming — computes the getaways.near response for the city
 *      (OSRM table drive times for the top candidates, 7 d per-leg cache)
 *      and stores it under the v2 key `getaways:v2:near:<city>:150`
 *      (nearCacheKeyFor — do NOT hand-roll v1 keys) for 30 days. The 24 h
 *      `getaway:{city}` enrichment marker is set too.
 *
 * RESUMABLE: progress lives in api_cache under 'seed:getaways-world-topup'
 * ({done: ["City|Country", …], failed, inserted, updatedAt}), written after
 * EVERY city, so a restart (sandbox wipes local files) skips completed
 * cities. Run with RESET=1 to start over. A failed city is logged and the
 * run CONTINUES, never aborts; a resumed run retries it.
 *
 * Run:            npx tsx db/seed-getaways-world-topup.ts
 * Background:     nohup npx tsx db/seed-getaways-world-topup.ts > /tmp/seed-world-topup.log 2>&1 &
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

/** Checkpoint key in api_cache — resume-safe across sandbox wipes. */
const PROGRESS_KEY = "seed:getaways-world-topup";
/** Minimum corpus size for a city to qualify. */
const MIN_ROWS = 150;
/** Cap on cities processed (top by row count). */
const MAX_CITIES = 80;
/** Overpass scan radius for the seeder's own <12 km/≤150 km filter. */
const SCAN_RADIUS_KM = 150;
/** Polite pacing between cities (quadrants pace themselves 1.5 s apart). */
const BETWEEN_CITIES_MS = 3_000;

interface CityRow {
  city: string;
  country: string;
  n: number;
  lat: number;
  lng: number;
}

interface Checkpoint {
  /** "City|Country" keys completed (success or no-candidates) */
  done: string[];
  failed: string[];
  inserted: number;
  updatedAt: string;
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const cityKey = (c: CityRow) => `${c.city}|${c.country}`;

/**
 * Some corpus rows store the city as "Pune, India" — strip a trailing
 * ", <country>" so enrichment rows and the warmed near-cache key use the
 * plain city name (matching what the live near({city}) handler requests).
 */
function normalizeCityName(city: string, country: string): string {
  const suffix = `, ${country}`;
  if (city.toLowerCase().endsWith(suffix.toLowerCase())) {
    return city.slice(0, city.length - suffix.length).trim();
  }
  return city.trim();
}

/**
 * Cities with ≥MIN_ROWS approved rows and no getaway coverage yet: neither
 * the 24 h `getaway:<city>` marker nor the 30-day v2 near cache exists in
 * api_cache. Expired api_cache rows count as missing (getaway markers are
 * 24 h TTL — a live marker means someone enriched very recently).
 */
async function pickCities(): Promise<CityRow[]> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT c.city, c.country, c.n, c.lat, c.lng
    FROM (
      SELECT city, country, COUNT(*) AS n, AVG(lat) AS lat, AVG(lng) AS lng
      FROM explore_places
      WHERE approved = 1 AND lat IS NOT NULL AND lng IS NOT NULL
      GROUP BY city, country
      HAVING n >= ${MIN_ROWS}
    ) c
    WHERE NOT EXISTS (
        SELECT 1 FROM api_cache k
        WHERE k.k = CONCAT('getaway:', LOWER(TRIM(c.city)))
          AND k.expiresAt > NOW()
      )
      AND NOT EXISTS (
        SELECT 1 FROM api_cache k
        WHERE k.k = CONCAT('getaways:v2:near:', LOWER(TRIM(c.city)), ':150')
          AND k.expiresAt > NOW()
      )
    ORDER BY c.n DESC
    LIMIT ${MAX_CITIES}
  `);
  const rows = (Array.isArray(res) ? res[0] : res) as unknown as CityRow[];
  return rows
    .map((r) => ({
      city: normalizeCityName(r.city, r.country),
      country: r.country,
      n: Number(r.n),
      lat: Number(r.lat),
      lng: Number(r.lng),
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.city.length > 0);
}

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
  // 24 h marker — a live near({city}) won't re-run the Overpass pass we just did.
  await cacheSet(cacheKey("getaway:", normName(c.city)), enrich, 24 * 60 * 60 * 1000);
  // 30-day full response (OSRM legs get their own 7 d cache inside). v2 key
  // via nearCacheKeyFor — matches what the live getaways.near handler reads.
  const key = nearCacheKeyFor({ city: c.city, radiusKm: 150 });
  const hit = await cacheGet(key);
  if (hit) return; // already warm — don't burn OSRM quota
  const result = await computeGetawaysNearForAnchor(
    { city: c.city, lat: c.lat, lng: c.lng },
    { radiusKm: 150, limit: 24 },
  );
  await cacheSet(key, { ...result, cachedAt: new Date().toISOString() }, NEAR_CACHE_TTL_MS);
}

const startedAt = Date.now();
console.log(
  `[seed-getaways-world-topup] selecting corpus cities with ≥${MIN_ROWS} rows, no getaway coverage (cap ${MAX_CITIES})`,
);

if (process.env.RESET === "1") {
  await cacheSet(
    PROGRESS_KEY,
    { done: [], failed: [], inserted: 0, updatedAt: new Date().toISOString() },
    SEED_CHECKPOINT_TTL_MS,
  );
  console.log("[seed-getaways-world-topup] RESET=1 — checkpoint cleared");
}

const checkpoint = (await cacheGet<Checkpoint>(PROGRESS_KEY)) ?? {
  done: [],
  failed: [],
  inserted: 0,
  updatedAt: new Date().toISOString(),
};

const cities = await pickCities();
console.log(
  `[seed-getaways-world-topup] ${cities.length} qualifying cities, ${checkpoint.done.length} already done — resuming`,
);

let completedThisRun = 0;
for (const c of cities) {
  const key = cityKey(c);
  if (checkpoint.done.includes(key)) continue;
  try {
    const enrich = await seedCity(c);
    await warmCityCache(c, enrich);
    checkpoint.inserted += enrich.inserted;
    checkpoint.done.push(key);
    completedThisRun++;
    console.log(
      `[seed-getaways-world-topup] ${c.city}, ${c.country} (${c.n} corpus) — fetched ${enrich.fetched}, inserted +${enrich.inserted} [done ${checkpoint.done.length}/${cities.length}]`,
    );
  } catch (e) {
    // NOT marked done — a resumed run retries it (failures are usually
    // transient Overpass outages); it's recorded once in failed[] for the log.
    if (!checkpoint.failed.includes(key)) checkpoint.failed.push(key);
    console.error(
      `[seed-getaways-world-topup] ${c.city}, ${c.country} — FAILED: ${e instanceof Error ? e.message : e}`,
    );
  }
  checkpoint.updatedAt = new Date().toISOString();
  await cacheSet(PROGRESS_KEY, checkpoint, SEED_CHECKPOINT_TTL_MS);
  await sleep(BETWEEN_CITIES_MS);
}

console.log(
  `[seed-getaways-world-topup] DONE in ${((Date.now() - startedAt) / 1000).toFixed(0)}s — ` +
    `${completedThisRun} cities this run, ${checkpoint.done.length}/${cities.length} total, ` +
    `+${checkpoint.inserted} getaways inserted, ${checkpoint.failed.length} failed`,
);
process.exit(0);
