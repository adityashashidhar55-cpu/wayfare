/**
 * Getaways city seeder at scale (r14-nearby) - overnight "what's nearby"
 * coverage for the biggest corpus cities worldwide.
 *
 * Run:            npx tsx db/seed-getaways-cities.ts
 * Background:     nohup npx tsx db/seed-getaways-cities.ts > /tmp/seed-getaways.log 2>&1 &
 *
 * City selection: the top ~100 cities by explore_places row count (spread
 * worldwide, max 8 per country, Bengaluru excluded - its r13 seed already
 * ran). Anchors come from the corpus centroid (AVG lat/lng of the city's
 * rows), so NO Photon calls are needed.
 *
 * Per city:
 *   1. Overpass getaway scan - peaks/volcanoes/hot springs/caves,
 *      waterfalls, viewpoints, nature reserves, forts/ruins and hiking
 *      routes within 120 km, as 2×2 quadrant queries (fetchGetawayElements;
 *      mirrors rotate, 429/5xx back off, quadrants pace 1.5 s apart).
 *   2. Filter + dedupe - unnamed/unpositioned dropped, <12 km from the city
 *      center dropped (city sights, not getaways), generic placeholder names
 *      dropped (isGenericName), then osmId + normalized-name dedupe against
 *      the existing corpus and within the batch. Rows insert exactly like
 *      the Bengaluru seeder (source 'osm', rating 4.3, getaway styles).
 *   3. Cache warming - computes the getaways.near response for the city
 *      (OSRM table drive times for the top candidates, 7 d per-leg cache)
 *      and stores it under `getaways:v1:near:<city>:150` for 30 days, so the
 *      first real visitor gets an instant, external-HTTP-free answer. The
 *      24 h `getaway:{city}` enrichment marker is set too.
 *
 * RESUMABLE: progress lives in api_cache under 'getaways-seed:progress'
 * ({done: ["City|Country", …], failed, inserted, updatedAt}), written after
 * EVERY city, so a restart (sandbox wipes local files) skips completed
 * cities. Delete that key (or run with RESET=1) to start over. A failed city
 * is logged and the run CONTINUES, never aborts.
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
  SEED_PROGRESS_KEY,
  CITY_SIGHT_KM,
} from "../api/lib/getaways-shared";
import {
  computeGetawaysNearForAnchor,
  fetchGetawayElements,
  normalizeGetawayElement,
} from "../api/getaways-router";

type ExplorePlaceInsert = typeof schema.explorePlaces.$inferInsert;

/** ~100 target cities, max this many per country. */
const TARGET_CITY_COUNT = 100;
const MAX_PER_COUNTRY = 8;
/** Bengaluru's r13 seed (curated + enrichment) already ran. */
const EXCLUDED_CITIES = new Set(["bengaluru", "bangalore"]);
/** Overpass scan radius for the seeder's own <12 km/≤150 km filter. */
const SCAN_RADIUS_KM = 150;
/** Polite pacing between cities (quadrants pace themselves 1.5 s apart). */
const BETWEEN_CITIES_MS = 2_000;

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
 * Some corpus rows store the city as "Pune, India" - strip a trailing
 * ", <country>" so enrichment rows and the warmed near-cache key use the
 * plain city name (matching what CityBuilder's near({city}) requests).
 */
function normalizeCityName(city: string, country: string): string {
  const suffix = `, ${country}`;
  if (city.toLowerCase().endsWith(suffix.toLowerCase())) {
    return city.slice(0, city.length - suffix.length).trim();
  }
  return city.trim();
}

/** Top corpus cities by place count, spread worldwide (per-country cap). */
async function pickCities(): Promise<CityRow[]> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT city, country, COUNT(*) AS n, AVG(lat) AS lat, AVG(lng) AS lng
    FROM explore_places
    WHERE approved = 1 AND lat IS NOT NULL AND lng IS NOT NULL
    GROUP BY city, country
    ORDER BY n DESC
    LIMIT 800
  `);
  const rows = (Array.isArray(res) ? res[0] : res) as unknown as CityRow[];
  const perCountry = new Map<string, number>();
  const picked: CityRow[] = [];
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (EXCLUDED_CITIES.has(normName(r.city))) continue;
    const used = perCountry.get(r.country) ?? 0;
    if (used >= MAX_PER_COUNTRY) continue;
    perCountry.set(r.country, used + 1);
    picked.push({
      city: normalizeCityName(r.city, r.country),
      country: r.country,
      n: Number(r.n),
      lat,
      lng,
    });
    if (picked.length >= TARGET_CITY_COUNT) break;
  }
  return picked;
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
  // 24 h marker - a live near({city}) won't re-run the Overpass pass we just did.
  await cacheSet(cacheKey("getaway:", normName(c.city)), enrich, 24 * 60 * 60 * 1000);
  // 30-day full response (OSRM legs get their own 7 d cache inside).
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
console.log(`[seed-getaways-cities] picking top ${TARGET_CITY_COUNT} corpus cities (≤${MAX_PER_COUNTRY}/country)`);

if (process.env.RESET === "1") {
  await cacheSet(SEED_PROGRESS_KEY, { done: [], failed: [], inserted: 0, updatedAt: new Date().toISOString() }, SEED_CHECKPOINT_TTL_MS);
  console.log("[seed-getaways-cities] RESET=1, checkpoint cleared");
}

const checkpoint = (await cacheGet<Checkpoint>(SEED_PROGRESS_KEY)) ?? {
  done: [],
  failed: [],
  inserted: 0,
  updatedAt: new Date().toISOString(),
};

const cities = await pickCities();
console.log(
  `[seed-getaways-cities] ${cities.length} cities picked, ${checkpoint.done.length} already done, resuming`,
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
      `[seed-getaways-cities] ${c.city}, ${c.country} (${c.n} corpus), fetched ${enrich.fetched}, inserted +${enrich.inserted} [done ${checkpoint.done.length}/${cities.length}]`,
    );
  } catch (e) {
    // NOT marked done - a resumed run retries it (failures are usually
    // transient Overpass outages); it's recorded once in failed[] for the log.
    if (!checkpoint.failed.includes(key)) checkpoint.failed.push(key);
    console.error(
      `[seed-getaways-cities] ${c.city}, ${c.country} · FAILED: ${e instanceof Error ? e.message : e}`,
    );
  }
  checkpoint.updatedAt = new Date().toISOString();
  await cacheSet(SEED_PROGRESS_KEY, checkpoint, SEED_CHECKPOINT_TTL_MS);
  await sleep(BETWEEN_CITIES_MS);
}

console.log(
  `[seed-getaways-cities] DONE in ${((Date.now() - startedAt) / 1000).toFixed(0)}s, ` +
    `${completedThisRun} cities this run, ${checkpoint.done.length}/${cities.length} total, ` +
    `+${checkpoint.inserted} getaways inserted, ${checkpoint.failed.length} failed`,
);
process.exit(0);
