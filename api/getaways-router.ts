// r13-getaways - "Getaways - within ~2 hours" for the City Builder.
//
// `near` resolves an anchor (city name via Photon, or raw lat/lng), gathers
// small-hike / nature / heritage candidates around it from TWO sources:
//   (a) the explore_places corpus (bbox ±1.6° lat / lng scaled by cos(lat)),
//   (b) a live Overpass enrichment pass that runs ONCE per city (24 h
//       api_cache marker `getaway:{normcity}`) and upserts peaks, waterfalls,
//       viewpoints, nature reserves, forts/ruins and hiking routes into the
//       corpus through a local normalizer shaped after coverage.ts's.
// Every candidate gets a driving estimate: real OSRM road durations for the
// top few (single table call, ≤ 12 destinations, 7 d `osrm:drv:` cache),
// haversine × 1.4 at 55 km/h (flagged `estimated`) for the rest. Places
// inside the anchor city itself (< 12 km) are excluded - those are city
// sights, not getaways. Results come back grouped: hikes / nature / heritage.

import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import {
  geocodeCity,
  importCityPlaces,
  reverseGeocodePoint,
  titleCase,
  type CityGeocode,
  type OverpassElement,
} from "./queries/overpass";
import { kmBetween, postCoverageQuery, radiusBbox, sleep } from "./queries/coverage";
import { cacheGet, cacheKey, cacheSet } from "./lib/cache";
import { fetchJson } from "./lib/http";
import { isGenericName, isParkingLikeName } from "./lib/place-quality";
import {
  AROUND_ME_CACHE_TTL_MS,
  aroundMeCacheKeyFor,
  aroundMeScore,
  cacheThrough,
  CITY_SIGHT_KM,
  classifyGetaway,
  dedupePlaces,
  GETAWAY_KEYWORD_RE,
  matchesStyle,
  NEAR_CACHE_TTL_MS,
  nearCacheKeyFor,
  type GetawayGroupKey,
} from "./lib/getaways-shared";

export { classifyGetaway, GETAWAY_KEYWORD_RE };
export type { GetawayGroupKey };

type ExplorePlaceInsert = typeof schema.explorePlaces.$inferInsert;
type ExplorePlaceRow = typeof schema.explorePlaces.$inferSelect;

// ─── keyword vocabulary ──────────────────────────────────────────────────────

/** SQL-side twin of GETAWAY_KEYWORD_RE (broad substrings; JS re-checks). */
const KEYWORD_SQL =
  "peak|hill|trek|hike|trail|viewpoint|waterfall|falls|reserve|fort|ruins|lake|dam|sanctuary|caves?|heritage|gorge|hot[ -]?spring";

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** r14-nearby - api/lib/cache.ts's get/set pair as a CacheLike. */
const apiCache: import("./lib/getaways-shared").CacheLike = {
  get: <T>(k: string) => cacheGet<T>(k),
  set: (k: string, v: unknown, ttlMs: number) => cacheSet(k, v, ttlMs),
};

// ─── live Overpass enrichment (once per city, 24 h marker) ──────────────────

const GETAWAY_ENRICH_RADIUS_KM = 120;
const GETAWAY_ENRICH_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const GETAWAY_EMPTY_RETRY_TTL_MS = 60 * 60 * 1000; // 1 h when Overpass gave nothing

function buildGetawayOverpassQuery(bb: string): string {
  return `[out:json][timeout:40];
(
  node["natural"~"peak|volcano|hot_spring|cave_entrance"](${bb});
  node["waterway"="waterfall"](${bb});
  node["tourism"="viewpoint"](${bb});
  node["leisure"="nature_reserve"](${bb});
  node["historic"~"fort|ruins"](${bb});
  way["natural"~"peak|volcano|hot_spring|cave_entrance"](${bb});
  way["waterway"="waterfall"](${bb});
  way["tourism"="viewpoint"](${bb});
  way["leisure"="nature_reserve"](${bb});
  way["historic"~"fort|ruins"](${bb});
  relation["route"="hiking"](${bb});
);
out center tags 150;`;
}

/**
 * The full-radius getaway scan as 2×2 quadrant queries. One monolithic query
 * over a dense region (Tokyo) blows Overpass's server-side timeout, which it
 * reports as a 200 with an empty elements array - quadrants keep each scan
 * small enough to finish. A failed quadrant is skipped, not fatal.
 */
export async function fetchGetawayElements(
  lat: number,
  lng: number,
): Promise<OverpassElement[]> {
  const b = radiusBbox(lat, lng, GETAWAY_ENRICH_RADIUS_KM);
  const midLat = (b.s + b.n) / 2;
  const midLng = (b.w + b.e) / 2;
  const quads = [
    { s: b.s, w: b.w, n: midLat, e: midLng },
    { s: b.s, w: midLng, n: midLat, e: b.e },
    { s: midLat, w: b.w, n: b.n, e: midLng },
    { s: midLat, w: midLng, n: b.n, e: b.e },
  ];
  const seen = new Set<string>();
  const out: OverpassElement[] = [];
  for (let i = 0; i < quads.length; i++) {
    if (i > 0) await sleep(1_500); // polite pacing between quadrant passes
    const q = quads[i]!;
    try {
      const elements = await postCoverageQuery(
        buildGetawayOverpassQuery(`${q.s},${q.w},${q.n},${q.e}`),
        { attempts: 2, backoffMs: 5_000, timeoutMs: 60_000 },
      );
      for (const el of elements) {
        const key = `${el.type}/${el.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(el);
      }
    } catch {
      /* quadrant failed\u2014 partial coverage is fine, marker stays uncached */
    }
  }
  return out;
}

/**
 * Normalize one getaway Overpass element into an explore_places row. Shaped
 * after coverage.ts's normalizeCoverageElement, but mapped onto the getaway
 * vocabulary: forts/ruins → 'historic', peaks/hikes/viewpoints → 'adventure',
 * falls/reserves/springs/caves → 'natural'.
 */
export function normalizeGetawayElement(
  el: OverpassElement,
  city: string,
  country: string,
): ExplorePlaceInsert | null {
  const tags = el.tags ?? {};
  const name = (tags.name ?? tags["name:en"] ?? "").trim();
  if (!name) return null;
  const lat = el.type === "node" ? el.lat : el.center?.lat;
  const lng = el.type === "node" ? el.lon : el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const natural = tags.natural ?? "";
  const waterway = tags.waterway ?? "";
  const tourism = tags.tourism ?? "";
  const leisure = tags.leisure ?? "";
  const historic = tags.historic ?? "";
  const route = tags.route ?? "";

  let category = "natural";
  const placeTags: string[] = [];
  const push = (t: string) => {
    if (!placeTags.includes(t) && placeTags.length < 4) placeTags.push(t);
  };

  if (historic === "fort" || historic === "ruins") {
    category = "historic";
    push(historic);
    push("historic");
  } else if (natural === "peak" || natural === "volcano") {
    category = "adventure";
    push("peak");
    push("hike");
  } else if (route === "hiking") {
    category = "adventure";
    push("hike");
    push("trail");
  } else if (waterway === "waterfall" || natural === "waterfall") {
    push("waterfall");
    push("nature");
  } else if (tourism === "viewpoint") {
    category = "adventure";
    push("viewpoint");
    push("views");
  } else if (leisure === "nature_reserve") {
    push("reserve");
    push("nature");
  } else if (natural === "hot_spring") {
    push("hot-spring");
    push("nature");
  } else if (natural === "cave_entrance") {
    push("caves");
    push("nature");
  } else {
    return null; // not a getaway kind we model
  }

  return {
    name: name.slice(0, 255),
    osmId: `${el.type}/${el.id}`.slice(0, 32),
    source: "osm",
    city,
    country,
    category,
    tags: placeTags,
    styles: category === "historic" ? ["historical"] : ["adventure"],
    // r25: OSM has no rating/price data - see overpass.ts. NULL, not a
    // constant the UI renders as a real star rating.
    rating: null,
    priceLevel: null,
    feeCents: null,
    feeCurrency: null,
    feeNote: null,
    description: null,
    hidden: false,
    image: null,
    lat,
    lng,
  };
}

export interface GetawayEnrichResult {
  fetched: number;
  inserted: number;
}

/**
 * One live Overpass getaway pass around a city, upserting into explore_places
 * (dedupe on osmId, then normalized name - same convention as deepImportCity).
 * Runs at most once per city per 24 h (api_cache marker `getaway:{normcity}`);
 * the marker is only written on success, so an Overpass outage just retries
 * next visit. Idempotent.
 */
export async function enrichCityGetaways(
  cityInput: string,
  geo?: CityGeocode,
): Promise<GetawayEnrichResult> {
  const city = titleCase(cityInput);
  const markerKey = cacheKey("getaway:", normName(city));
  const cached = await cacheGet<GetawayEnrichResult>(markerKey);
  if (cached) return cached;

  const g = geo ?? (await geocodeCity(city));
  if (!g) return { fetched: 0, inserted: 0 };
  const b = radiusBbox(g.lat, g.lng, GETAWAY_ENRICH_RADIUS_KM);

  const elements = await fetchGetawayElements(g.lat, g.lng);

  // Dedupe targets: everything the corpus already holds in the bbox.
  const db = getDb();
  const existing = await db
    .select({ name: schema.explorePlaces.name, osmId: schema.explorePlaces.osmId })
    .from(schema.explorePlaces)
    .where(
      and(
        gte(schema.explorePlaces.lat, b.s),
        lte(schema.explorePlaces.lat, b.n),
        gte(schema.explorePlaces.lng, b.w),
        lte(schema.explorePlaces.lng, b.e),
      ),
    );
  const existingOsmIds = new Set(existing.map((r) => r.osmId).filter((v): v is string => v != null));
  const existingNames = new Set(existing.map((r) => normName(r.name)));

  const rows: ExplorePlaceInsert[] = [];
  const batchOsmIds = new Set<string>();
  for (const el of elements) {
    const row = normalizeGetawayElement(el, city, g.country);
    if (!row) continue;
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

  const result: GetawayEnrichResult = { fetched: elements.length, inserted: rows.length };
  // fetched=0 almost always means Overpass timed out server-side (it reports
  // that as a 200 with no elements) - retry soon instead of pinning the
  // empty result for a day.
  await cacheSet(
    markerKey,
    result,
    elements.length > 0 ? GETAWAY_ENRICH_TTL_MS : GETAWAY_EMPTY_RETRY_TTL_MS,
  );
  return result;
}

// ─── driving times (OSRM table, 7 d per-pair cache, haversine fallback) ─────

const OSRM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 d
const OSRM_MAX_DESTINATIONS = 12;
/** Straight-line → road fudge + assumed getaway speed for estimates. */
const EST_ROAD_FACTOR = 1.4;
const EST_SPEED_KMH = 55;

interface DriveInfo {
  driveMin: number;
  driveKm: number;
  estimated: boolean;
}

const coordKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

function estimateDrive(fromLat: number, fromLng: number, toLat: number, toLng: number): DriveInfo {
  const km = kmBetween(fromLat, fromLng, toLat, toLng) * EST_ROAD_FACTOR;
  return { driveMin: Math.round((km / EST_SPEED_KMH) * 60), driveKm: Math.round(km), estimated: true };
}

/**
 * Real road durations from the anchor to up to OSRM_MAX_DESTINATIONS
 * candidates via ONE OSRM table call (sources=0). Each leg is cached 7 d
 * under `osrm:drv:{from}->{to}`; uncached destinations beyond the cap - and
 * every leg when OSRM is unreachable - fall back to haversine estimates
 * flagged `estimated`. Never throws.
 */
async function driveTimesFrom(
  fromLat: number,
  fromLng: number,
  tos: { lat: number; lng: number }[],
): Promise<DriveInfo[]> {
  const out: (DriveInfo | null)[] = new Array(tos.length).fill(null);
  const need: number[] = [];

  for (let i = 0; i < tos.length; i++) {
    const key = cacheKey("osrm:drv:", `${coordKey(fromLat, fromLng)}>${coordKey(tos[i]!.lat, tos[i]!.lng)}`);
    const hit = await cacheGet<DriveInfo>(key);
    if (hit) out[i] = hit;
    else need.push(i);
  }

  const batch = need.slice(0, OSRM_MAX_DESTINATIONS);
  if (batch.length > 0) {
    try {
      const coords = [
        `${fromLng},${fromLat}`,
        ...batch.map((i) => `${tos[i]!.lng},${tos[i]!.lat}`),
      ].join(";");
      const data = await fetchJson<{
        code?: string;
        durations?: (number | null)[][];
        distances?: (number | null)[][];
      }>(
        `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`,
        { timeoutMs: 12_000, service: "osrm" },
      );
      if (data.code !== "Ok" || !data.durations?.[0]) throw new Error("OSRM table not Ok");
      for (let k = 0; k < batch.length; k++) {
        const i = batch[k]!;
        const sec = data.durations[0]![k + 1];
        const m = data.distances?.[0]?.[k + 1];
        if (typeof sec !== "number") continue; // unroutable - estimate below
        const info: DriveInfo = {
          driveMin: Math.max(1, Math.round(sec / 60)),
          driveKm: typeof m === "number" ? Math.round(m / 1000) : 0,
          estimated: false,
        };
        out[i] = info;
        const key = cacheKey(
          "osrm:drv:",
          `${coordKey(fromLat, fromLng)}>${coordKey(tos[i]!.lat, tos[i]!.lng)}`,
        );
        void cacheSet(key, info, OSRM_TTL_MS);
      }
    } catch {
      /* OSRM down\u2014 every uncached leg falls through to the estimate */
    }
  }

  return out.map(
    (info, i) => info ?? estimateDrive(fromLat, fromLng, tos[i]!.lat, tos[i]!.lng),
  );
}

// ─── router ──────────────────────────────────────────────────────────────────

export type GetawayPlace = ExplorePlaceRow & {
  group: GetawayGroupKey;
  kind: string;
  driveMin: number;
  driveKm: number;
  estimated: boolean;
};

export interface GetawaysNearResult {
  anchor: { city: string | null; lat: number; lng: number };
  groups: Record<GetawayGroupKey, GetawayPlace[]>;
  total: number;
}

/** r14-nearby - cached near() responses carry the computation timestamp. */
export type GetawaysNearPayload = GetawaysNearResult & { cachedAt: string };

/** Categories we treat as getaway-worthy corpus rows (food/shopping never). */
const GETAWAY_CATEGORIES = ["activity", "natural", "historic", "adventure"] as const;
const PER_GROUP_CAP = 8;

/**
 * The near() computation for an already-resolved anchor (steps 2–6 of the
 * original handler). Exported so the r14 seeder can warm the 30-day response
 * cache per city without going through Photon.
 */
export async function computeGetawaysNearForAnchor(
  anchor: { city: string | null; lat: number; lng: number },
  input: { radiusKm: number; limit: number },
): Promise<GetawaysNearResult> {
  const { city, lat, lng } = anchor;

  // 2. corpus candidates in a ±1.6° lat / lng-scaled bbox. The keyword
  //    prefilter runs in SQL (broad substring REGEXP over name + tags)
  //    so a giant city corpus can't bury getaway rows past a row cap;
  //    classifyGetaway re-applies it precisely (word boundaries) in JS.
  const b = radiusBbox(lat, lng, Math.max(input.radiusKm, 178)); // 178 km ≈ 1.6°
  const rows = await getDb()
    .select()
    .from(schema.explorePlaces)
    .where(
      and(
        eq(schema.explorePlaces.approved, true),
        inArray(schema.explorePlaces.category, [...GETAWAY_CATEGORIES]),
        gte(schema.explorePlaces.lat, b.s),
        lte(schema.explorePlaces.lat, b.n),
        gte(schema.explorePlaces.lng, b.w),
        lte(schema.explorePlaces.lng, b.e),
        sql`(LOWER(${schema.explorePlaces.name}) REGEXP ${KEYWORD_SQL} OR LOWER(CAST(${schema.explorePlaces.tags} AS CHAR)) REGEXP ${KEYWORD_SQL})`,
      ),
    )
    .orderBy(desc(schema.explorePlaces.rating))
    .limit(600);

  // 3. keyword + distance filter (drop in-city sights and OSM placeholder
  //    names like "Old Temple"), bucketed per group, best-rated first.
  const byGroup: Record<GetawayGroupKey, { row: ExplorePlaceRow; kind: string }[]> = {
    hikes: [],
    nature: [],
    heritage: [],
  };
  for (const row of rows) {
    if (row.lat == null || row.lng == null) continue;
    if (isGenericName(row.name)) continue;
    if (isParkingLikeName(row.name)) continue; // r15-places: no parking/rest-area getaways
    const distKm = kmBetween(lat, lng, row.lat, row.lng);
    if (distKm < CITY_SIGHT_KM || distKm > input.radiusKm) continue;
    const cls = classifyGetaway(row.name, row.tags);
    if (!cls) continue;
    byGroup[cls.group].push({ row, kind: cls.kind });
  }

  // 4. drive-time pool - top rated per group, round-robin interleaved so
  //    the ≤12 OSRM legs spread across all three groups.
  const GROUP_KEYS = ["hikes", "nature", "heritage"] as const;
  const poolPerGroup = Math.max(PER_GROUP_CAP, Math.ceil(input.limit / 3));
  const trimmed = GROUP_KEYS.map((k) => byGroup[k].slice(0, poolPerGroup));
  const candidates: { row: ExplorePlaceRow; group: GetawayGroupKey; kind: string }[] = [];
  for (let i = 0; candidates.length < Math.max(input.limit, PER_GROUP_CAP * 3); i++) {
    let added = false;
    for (let g = 0; g < GROUP_KEYS.length; g++) {
      const item = trimmed[g]![i];
      if (item) {
        candidates.push({ ...item, group: GROUP_KEYS[g]! });
        added = true;
      }
    }
    if (!added) break;
  }

  // 5. driving times (OSRM for the top few, estimates for the rest)
  const drives = await driveTimesFrom(
    lat,
    lng,
    candidates.map((c) => ({ lat: c.row.lat!, lng: c.row.lng! })),
  );

  // 6. group, sort by drive time, cap per group
  const groups: Record<GetawayGroupKey, GetawayPlace[]> = {
    hikes: [],
    nature: [],
    heritage: [],
  };
  candidates.forEach((c, i) => {
    const d = drives[i]!;
    groups[c.group].push({
      ...c.row,
      group: c.group,
      kind: c.kind,
      driveMin: d.driveMin,
      driveKm: d.driveKm,
      estimated: d.estimated,
    });
  });
  let total = 0;
  for (const key of GROUP_KEYS) {
    groups[key].sort((a, b) => a.driveMin - b.driveMin || (b.rating ?? 0) - (a.rating ?? 0));
    groups[key] = groups[key].slice(0, PER_GROUP_CAP);
    total += groups[key].length;
  }

  return { anchor: { city, lat, lng }, groups, total };
}

/** Anchor resolution for near() - geocodes the city and live-enriches once/24 h. */
async function resolveNearAnchor(input: {
  city?: string;
  lat?: number;
  lng?: number;
}): Promise<{ city: string | null; lat: number; lng: number }> {
  let city: string | null = null;
  let anchorLat = input.lat;
  let anchorLng = input.lng;
  if (input.city) {
    city = titleCase(input.city);
    const geo = await geocodeCity(city);
    if (!geo) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `We couldn't find “${input.city}” on the map, check the spelling or try a nearby larger town.`,
      });
    }
    anchorLat = geo.lat;
    anchorLng = geo.lng;
    // Live enrichment runs once per city (24 h marker); an Overpass
    // outage must never break the request - corpus alone still answers.
    try {
      await enrichCityGetaways(city, geo);
    } catch {
      /* corpus-only fallback */
    }
  }
  if (anchorLat == null || anchorLng == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Provide a city or lat/lng to find getaways.",
    });
  }
  return { city, lat: anchorLat, lng: anchorLng };
}

// ─── aroundMe ────────────────────────────────────────────────────────────────

/** Radius for "getaways" lane of aroundMe. */
export const AROUND_ME_GETAWAY_KM = 150;
/** Radius for the "right here" lane of top-rated corpus places. */
export const AROUND_ME_NEARBY_KM = 40;

export interface AroundMePlace {
  id: number;
  name: string;
  city: string;
  country: string;
  category: string;
  tags: string[] | null;
  rating: number | null;
  image: string | null;
  famousEatery: boolean;
  lat: number;
  lng: number;
  /** straight-line distance from the anchor */
  distKm: number;
  driveMin: number;
  driveKm: number;
  estimated: boolean;
  /** chip label - getaway kind (peak/waterfall/…) or category-derived */
  kind: string;
  /** which lane the place came from */
  scope: "getaway" | "nearby";
  score: number;
}

export interface AroundMeResult {
  anchor: { lat: number; lng: number };
  styles: string[];
  places: AroundMePlace[];
  total: number;
}

export type AroundMePayload = AroundMeResult & { cachedAt: string };

/** Display kind for a non-getaway corpus row, from tags then category. */
function nearbyKind(row: ExplorePlaceRow): string {
  const tags = (row.tags ?? []).map((t) => t.toLowerCase());
  const preference = [
    "museum",
    "cafe",
    "restaurant",
    "market",
    "beach",
    "park",
    "garden",
    "lake",
    "viewpoint",
    "views",
    "temple",
    "church",
    "mosque",
    "nightlife",
    "shopping",
    "landmark",
  ];
  for (const p of preference) {
    if (tags.includes(p)) return p === "views" ? "viewpoint" : p;
  }
  return row.category;
}

/**
 * r27: below this many corpus rows inside the 150 km box, "Around me" is
 * treated as uncovered and we try a live import rather than returning nothing.
 */
const MIN_AROUND_ME_ROWS = 10;

/** Coalesced, never-throwing city import for the aroundMe fallback. */
const aroundMeImports = new Map<string, Promise<boolean>>();

async function tryImportNearby(city: string): Promise<boolean> {
  const key = city.trim().toLowerCase();
  const existing = aroundMeImports.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await importCityPlaces(city);
      return (res?.inserted ?? 0) > 0 || (res?.total ?? 0) > 0;
    } catch (e) {
      console.warn(`getaways: aroundMe import failed for "${city}"`, e);
      return false;
    } finally {
      aroundMeImports.delete(key);
    }
  })();
  aroundMeImports.set(key, p);
  return p;
}

/** Photon reverse geocode, cached 30d upstream. Null when we can't name it. */
async function cityNameFor(lat: number, lng: number): Promise<string | null> {
  const rev = await reverseGeocodePoint(lat, lng);
  const city = rev?.city?.trim();
  return city ? city : null;
}

/**
 * The aroundMe computation: getaways within 150 km (≥12 km out - same band
 * as near) PLUS top-rated corpus places within ~40 km, preference-matched,
 * deduped, ranked by the rating×distance blend, with real OSRM drive times
 * for the top ≤12 and haversine estimates beyond.
 */
async function computeAroundMe(input: {
  lat: number;
  lng: number;
  styles: string[];
  limit: number;
}): Promise<AroundMeResult> {
  const { lat, lng, styles } = input;

  // One corpus scan over the 150 km bbox; lanes split by distance in JS.
  const b = radiusBbox(lat, lng, AROUND_ME_GETAWAY_KM);
  const scanBbox = () =>
    getDb()
      .select()
      .from(schema.explorePlaces)
      .where(
        and(
          eq(schema.explorePlaces.approved, true),
          gte(schema.explorePlaces.lat, b.s),
          lte(schema.explorePlaces.lat, b.n),
          gte(schema.explorePlaces.lng, b.w),
          lte(schema.explorePlaces.lng, b.e),
        ),
      )
      .orderBy(desc(schema.explorePlaces.rating))
      .limit(1200);

  let rows = await scanBbox();
  // r27: on-demand import when the corpus has nothing near the user. Like the
  // main explore feed, this rail had no live fallback - "Around me" was simply
  // blank for anyone standing outside the seeded cities, which on a fresh
  // database is everyone. Reverse-geocode to a city name and run the same free
  // OSM importer the rest of the app uses.
  if (rows.length < MIN_AROUND_ME_ROWS) {
    const city = await cityNameFor(lat, lng);
    if (city && (await tryImportNearby(city))) {
      rows = await scanBbox();
    }
  }

  interface Cand {
    row: ExplorePlaceRow;
    distKm: number;
    kind: string;
    scope: "getaway" | "nearby";
  }
  const cands: Cand[] = [];
  for (const row of rows) {
    if (row.lat == null || row.lng == null) continue;
    if (isGenericName(row.name)) continue;
    if (isParkingLikeName(row.name)) continue; // r15-places: no parking/rest-area getaways
    const distKm = kmBetween(lat, lng, row.lat, row.lng);
    if (distKm > AROUND_ME_GETAWAY_KM) continue;
    const cls = classifyGetaway(row.name, row.tags);
    if (distKm >= CITY_SIGHT_KM && cls) {
      cands.push({ row, distKm, kind: cls.kind, scope: "getaway" });
    } else if (distKm <= AROUND_ME_NEARBY_KM) {
      cands.push({ row, distKm, kind: cls?.kind ?? nearbyKind(row), scope: "nearby" });
    }
  }

  // Preference match (union semantics; empty styles = everything), then
  // dedupe (same place as OSM node + curated row) and rank.
  const matched = dedupePlaces(
    cands
      .filter((c) => matchesStyle({ name: c.row.name, category: c.row.category, tags: c.row.tags }, styles))
      .map((c) => ({ ...c, id: c.row.id, name: c.row.name, lat: c.row.lat, lng: c.row.lng })),
  );

  // Getaways earn a scope bonus: the point of this rail is reachable
  // escapes (hikes, falls, heritage ~2h out), not another in-city statue.
  // +15 lifts a 4.5-rated getaway 60km out above a 4.3 landmark downtown,
  // but a far average getaway still loses to a top nearby pick.
  const GETAWAY_SCOPE_BONUS = 15;
  const scored = matched
    .map((c) => ({
      c,
      score:
        aroundMeScore({ rating: c.row.rating, distKm: c.distKm }) +
        (c.scope === "getaway" ? GETAWAY_SCOPE_BONUS : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(input.limit, 12)); // pool a little deep for the drive call
  const drives = await driveTimesFrom(
    lat,
    lng,
    top.map((t) => ({ lat: t.c.row.lat!, lng: t.c.row.lng! })),
  );
  const places: AroundMePlace[] = top.map((t, i) => {
    const d = drives[i]!;
    const r = t.c.row;
    return {
      id: r.id,
      name: r.name,
      city: r.city,
      country: r.country,
      category: r.category,
      tags: r.tags,
      rating: r.rating,
      image: r.image,
      famousEatery: r.famousEatery,
      lat: r.lat!,
      lng: r.lng!,
      distKm: Math.round(t.c.distKm * 10) / 10,
      driveMin: d.driveMin,
      driveKm: d.driveKm,
      estimated: d.estimated,
      kind: t.c.kind,
      scope: t.c.scope,
      score: t.score,
    };
  });
  // Final order: score, with real drive times breaking near-ties.
  places.sort((a, b) => b.score - a.score || a.driveMin - b.driveMin);
  const limited = places.slice(0, input.limit);
  return { anchor: { lat, lng }, styles, places: limited, total: limited.length };
}

export const getawaysRouter = createRouter({
  /**
   * r14-nearby - the FULL response is cached in api_cache for 30 days
   * (`getaways:v2:near:<city|latlng>:<radiusKm>`). A hit performs no
   * Photon/Overpass/OSRM calls at all; `cachedAt` tells the client when the
   * payload was computed. Compute errors are never cached.
   */
  near: authedQuery
    .input(
      z.object({
        city: z.string().trim().min(2).max(120).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        radiusKm: z.number().int().min(25).max(300).default(150),
        limit: z.number().int().min(1).max(48).default(24),
      }),
    )
    .query(async ({ input }): Promise<GetawaysNearPayload> => {
      const key = nearCacheKeyFor(input);
      return cacheThrough(apiCache, key, NEAR_CACHE_TTL_MS, async () => {
        const anchor = await resolveNearAnchor(input);
        return computeGetawaysNearForAnchor(anchor, input);
      });
    }),

  /**
   * r14-nearby - "Trips around you": preference-matched things to do around
   * an arbitrary point. Getaways within 150 km plus top-rated corpus places
   * within ~40 km, ranked by a distance×rating blend. Public (preferences
   * arrive as input); the full response caches 30 days under
   * `getaways:v2:aroundme:<0.25° cell>:<md5 sorted styles>` - a hit performs
   * no external HTTP.
   */
  aroundMe: publicQuery
    .input(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        styles: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
        limit: z.number().int().min(1).max(24).default(12),
      }),
    )
    .query(async ({ input }): Promise<AroundMePayload> => {
      const key = aroundMeCacheKeyFor(input);
      return cacheThrough(apiCache, key, AROUND_ME_CACHE_TTL_MS, () =>
        computeAroundMe(input),
      );
    }),
});
