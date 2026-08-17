/**
 * Coverage import machinery - deeper, wider OpenStreetMap imports per city.
 *
 * `importCityPlaces` (queries/overpass.ts) does ONE Overpass pass over a small
 * set of OSM classes, so cities end up missing most of their restaurants,
 * beaches, museums, parks, markets… `deepImportCity` instead runs FIVE themed
 * passes (culture / food-drink / café / nature / shopping+life - the café pass
 * is r13-cafes), each with its own
 * Overpass query and an adaptive per-pass cap (big city ~180, town ~80), then
 * dedupes by osmId + normalized name and inserts through the same conventions
 * as the existing importers (source 'osm', approved=true, country resolved
 * once per city).
 *
 * Also home to:
 *  - a tiny read-through cache helper on the api_cache table (used by the
 *    citybuild router and the world seeder checkpoint),
 *  - an in-memory point index so "how many corpus places sit within 25 km of
 *    this city?" can be answered for thousands of directory cities without
 *    hammering MySQL,
 *  - a polite Overpass poster: rotates public mirrors, backs off 30 s on
 *    429/502/503/504 and keeps going.
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import {
  classifyMarketplace,
  dietCuisineTags,
  geocodeCity,
  titleCase,
  type CityGeocode,
  type OverpassElement,
  type OverpassResponse,
} from "./overpass";
import { ExternalApiError, fetchJson } from "../lib/http";
import { osmImageFromTags } from "../lib/osm-photo"; // r13-photos
import { isParkingLikeName } from "../lib/place-quality"; // r15-places
import { funCategoryFor } from "../lib/classify-place"; // r15-places
import { pickDisplayName } from "../lib/latin-name"; // r19-portal

const USER_AGENT = "Wayfare/1.0 (travel app; OSM coverage import)";

export const OVERPASS_MIRRORS = [
  // r16: the French community instance + the mail.ru mirror respond reliably
  // from this network (~1-2 s); the three original mirrors were 504ing/hanging
  // at seed time. Both carry global data (France + Germany waves verified).
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── api_cache read-through helper ───────────────────────────────────────────

/** Read a JSON value from api_cache; null when missing, expired or corrupt. */
export async function cacheGet<T>(k: string): Promise<T | null> {
  try {
    const rows = await getDb()
      .select({ v: schema.apiCache.v, expiresAt: schema.apiCache.expiresAt })
      .from(schema.apiCache)
      .where(eq(schema.apiCache.k, k))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
    return JSON.parse(row.v) as T;
  } catch {
    return null; // cache must never break the request path
  }
}

/** Upsert a JSON value into api_cache with a TTL (ms from now). */
export async function cacheSet(k: string, v: unknown, ttlMs: number): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlMs);
    const serialized = JSON.stringify(v);
    await getDb()
      .insert(schema.apiCache)
      .values({ k, v: serialized, expiresAt })
      .onDuplicateKeyUpdate({ set: { v: serialized, expiresAt } });
  } catch {
    // caching is best-effort
  }
}

// ─── corpus point index (fast "places within 25 km") ─────────────────────────

export interface CorpusPoint {
  lat: number;
  lng: number;
}

export interface PointIndex {
  /** cell size in degrees (~0.25° ≈ 27.8 km of latitude) */
  cell: number;
  grid: Map<string, CorpusPoint[]>;
}

const INDEX_CELL_DEG = 0.25;

export function makePointIndex(points: CorpusPoint[]): PointIndex {
  const grid = new Map<string, CorpusPoint[]>();
  for (const p of points) {
    const key = `${Math.floor(p.lat / INDEX_CELL_DEG)},${Math.floor(p.lng / INDEX_CELL_DEG)}`;
    const list = grid.get(key) ?? [];
    list.push(p);
    grid.set(key, list);
  }
  return { cell: INDEX_CELL_DEG, grid };
}

/** Great-circle distance in km (haversine). */
export function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Add points to an existing index (cheap top-up after an import). */
export function addToPointIndex(idx: PointIndex, points: CorpusPoint[]): void {
  for (const p of points) {
    const key = `${Math.floor(p.lat / idx.cell)},${Math.floor(p.lng / idx.cell)}`;
    const list = idx.grid.get(key) ?? [];
    list.push(p);
    idx.grid.set(key, list);
  }
}

/**
 * Count indexed points within `radiusKm` of (lat,lng). The 3×3 neighbourhood
 * of 0.25° cells always fully covers a 25 km circle (≤ 0.225° in latitude),
 * and every candidate is haversine-checked so results are exact.
 */
export function countWithin(idx: PointIndex, lat: number, lng: number, radiusKm = 25): number {
  const cellLat = Math.floor(lat / idx.cell);
  const cellLng = Math.floor(lng / idx.cell);
  let n = 0;
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const list = idx.grid.get(`${cellLat + dLat},${cellLng + dLng}`);
      if (!list) continue;
      for (const p of list) {
        if (kmBetween(lat, lng, p.lat, p.lng) <= radiusKm) n++;
      }
    }
  }
  return n;
}

/** Every approved corpus point (lat/lng only - one lightweight scan). */
export async function corpusPoints(): Promise<CorpusPoint[]> {
  const rows = await getDb()
    .select({ lat: schema.explorePlaces.lat, lng: schema.explorePlaces.lng })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.approved, true));
  return rows.filter((r): r is CorpusPoint => r.lat != null && r.lng != null);
}

/** Approved corpus points within the `radiusKm` bbox of a point (DB-filtered). */
export async function corpusPointsNear(
  lat: number,
  lng: number,
  radiusKm = 25,
): Promise<CorpusPoint[]> {
  const b = radiusBbox(lat, lng, radiusKm);
  const rows = await getDb()
    .select({ lat: schema.explorePlaces.lat, lng: schema.explorePlaces.lng })
    .from(schema.explorePlaces)
    .where(
      and(
        eq(schema.explorePlaces.approved, true),
        gte(schema.explorePlaces.lat, b.s),
        lte(schema.explorePlaces.lat, b.n),
        gte(schema.explorePlaces.lng, b.w),
        lte(schema.explorePlaces.lng, b.e),
      ),
    );
  return rows.filter((r): r is CorpusPoint => r.lat != null && r.lng != null);
}

/** Count of approved corpus places within `radiusKm` (exact haversine). */
export async function corpusCountNear(lat: number, lng: number, radiusKm = 25): Promise<number> {
  const pts = await corpusPointsNear(lat, lng, radiusKm);
  return pts.filter((p) => kmBetween(lat, lng, p.lat, p.lng) <= radiusKm).length;
}

/** Lat/lng bounding box containing the `radiusKm` circle around a point. */
export function radiusBbox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / 111.32;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusKm / (111.32 * cosLat);
  return { s: lat - dLat, n: lat + dLat, w: lng - dLng, e: lng + dLng };
}

// ─── polite Overpass poster (mirror rotation + backoff) ─────────────────────

let mirrorOffset = 0;
/** per-mirror "dead until" timestamps - a mirror that hangs/network-fails is
 * skipped for 10 min so long bulk runs stop paying its timeout on every call */
const mirrorDeadUntil = new Map<string, number>();
const MIRROR_DEAD_MS = 10 * 60 * 1000;

function nextMirror(): string {
  const now = Date.now();
  for (let i = 0; i < OVERPASS_MIRRORS.length; i++) {
    const endpoint = OVERPASS_MIRRORS[mirrorOffset % OVERPASS_MIRRORS.length]!;
    mirrorOffset += 1;
    if ((mirrorDeadUntil.get(endpoint) ?? 0) <= now) return endpoint;
  }
  // every mirror is marked dead - fall back to plain rotation
  return OVERPASS_MIRRORS[mirrorOffset++ % OVERPASS_MIRRORS.length]!;
}

/**
 * POST one Overpass query, rotating the public mirrors on every attempt.
 * Rate-limit / gateway responses (429, 502, 503, 504) trigger a 30 s backoff
 * and the NEXT mirror is tried - bulk callers (the world seeder) wrap this in
 * their own per-city try/catch, so a run never aborts on a single failure.
 * Mirrors that hang or are unreachable are parked for 10 minutes.
 */
export async function postCoverageQuery(
  query: string,
  opts: { attempts?: number; backoffMs?: number; timeoutMs?: number } = {},
): Promise<OverpassElement[]> {
  const attempts = opts.attempts ?? 6;
  const backoffMs = opts.backoffMs ?? 30_000;
  let lastError: unknown = null;

  for (let i = 0; i < attempts; i++) {
    const endpoint = nextMirror();
    try {
      const data = await fetchJson<OverpassResponse>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: opts.timeoutMs ?? 45_000,
        userAgent: USER_AGENT,
        service: "overpass",
      });
      if (!Array.isArray(data.elements)) throw new Error("Overpass returned no elements array");
      return data.elements;
    } catch (e) {
      // Rate-limit / gateway responses (incl. HTML 504 pages - fetchJson flags
      // them via the content-type check) → cool down, then the next mirror.
      const status = e instanceof ExternalApiError ? e.status : null;
      lastError = e;
      if (status === 429 || status === 502 || status === 503 || status === 504) {
        await sleep(backoffMs); // cool down, then continue with the next mirror
        continue;
      }
      mirrorDeadUntil.set(endpoint, Date.now() + MIRROR_DEAD_MS); // park the hanging mirror
      await sleep(2_000); // brief pause, then next mirror
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass request failed");
}

// ─── themed coverage queries ─────────────────────────────────────────────────

export type CoverageTheme = "culture" | "food" | "cafe" | "nature" | "life"; // r13-cafes: dedicated cafe pass

interface ThemeDef {
  key: CoverageTheme;
  label: string;
  build: (bb: string, cap: number) => string;
}

/**
 * The four coverage passes. Each is a standalone Overpass query (nodes + ways)
 * over the city bbox, capped per pass so a dense city doesn't starve the
 * smaller themes - together they find the restaurants, cafés, beaches,
 * museums, parks, markets and playgrounds the single-pass importer misses.
 */
export const COVERAGE_THEMES: ThemeDef[] = [
  {
    key: "culture",
    label: "museums, galleries, theatres & historic sites",
    build: (bb, cap) => `[out:json][timeout:40];
(
  node["tourism"~"^(museum|gallery|theatre|arts_centre|attraction|viewpoint)$"](${bb});
  node["amenity"~"^(theatre|arts_centre|place_of_worship)$"](${bb});
  node["historic"](${bb});
  way["tourism"~"^(museum|gallery|theatre|arts_centre|attraction|viewpoint)$"](${bb});
  way["amenity"~"^(theatre|arts_centre|place_of_worship)$"](${bb});
  way["historic"](${bb});
);
out center tags ${cap};`,
  },
  {
    key: "food",
    label: "restaurants, cafés, bars, nightlife & bakeries",
    build: (bb, cap) => `[out:json][timeout:40];
(
  node["amenity"~"^(restaurant|cafe|bar|pub|nightclub|biergarten|music_venue|fast_food|food_court|marketplace|ice_cream|bistro)$"](${bb});
  node["shop"~"^(bakery|pastry|confectionery|deli)$"](${bb});
  way["amenity"~"^(restaurant|cafe|bar|pub|nightclub|biergarten|music_venue|fast_food|food_court|marketplace|ice_cream|bistro)$"](${bb});
  way["shop"~"^(bakery|pastry|confectionery|deli)$"](${bb});
);
out center tags ${cap};`,
  },
  // r13-cafes: cafés drown in the shared food pass - in a megacity the 180-cap
  // fills with restaurants/bars before cafés surface. A dedicated café pass
  // (amenity=cafe|juice_bar + cuisine=coffee_shop) with a doubled cap (see the
  // deepImportCity loop) gives big cities the hundreds of cafés they have.
  {
    key: "cafe",
    label: "cafés, coffee shops & juice bars",
    build: (bb, cap) => `[out:json][timeout:40];
(
  node["amenity"~"^(cafe|juice_bar)$"](${bb});
  node["cuisine"~"coffee_shop"](${bb});
  way["amenity"~"^(cafe|juice_bar)$"](${bb});
  way["cuisine"~"coffee_shop"](${bb});
);
out center tags ${cap};`,
  },
  {
    key: "nature",
    label: "parks, gardens, beaches & natural sights",
    build: (bb, cap) => `[out:json][timeout:40];
(
  node["leisure"~"^(park|garden|nature_reserve)$"](${bb});
  node["natural"~"^(beach|peak)$"](${bb});
  node["tourism"="viewpoint"](${bb});
  node["waterway"="waterfall"](${bb});
  way["leisure"~"^(park|garden|nature_reserve)$"](${bb});
  way["natural"~"^(beach|peak)$"](${bb});
  way["waterway"="waterfall"](${bb});
);
out center tags ${cap};`,
  },
  {
    key: "life",
    label: "malls, markets, squares & family/sport venues",
    build: (bb, cap) => `[out:json][timeout:40];
(
  node["shop"~"^(mall|marketplace|department_store)$"](${bb});
  node["place"="square"](${bb});
  node["highway"="pedestrian"](${bb});
  node["tourism"~"^(zoo|aquarium|theme_park)$"](${bb});
  node["leisure"~"^(water_park|playground|stadium|amusement_arcade|escape_game|go_kart|paintball|bowling_alley)$"](${bb});
  way["shop"~"^(mall|marketplace|department_store)$"](${bb});
  way["place"="square"](${bb});
  way["highway"="pedestrian"](${bb});
  way["tourism"~"^(zoo|aquarium|theme_park)$"](${bb});
  way["leisure"~"^(water_park|playground|stadium|amusement_arcade|escape_game|go_kart|paintball|bowling_alley)$"](${bb});
);
out center tags ${cap};`,
  },
];

// ─── element normalization (superset of the city-builder mapping) ────────────

type ExplorePlaceInsert = typeof schema.explorePlaces.$inferInsert;

const COVERAGE_FOOD_AMENITIES = new Set([
  "restaurant",
  "cafe",
  "bar",
  "pub",
  "fast_food",
  "food_court",
  "marketplace",
  "ice_cream",
  "bistro",
  "juice_bar", // r13-cafes
]);
const COVERAGE_FOOD_SHOPS = new Set(["bakery", "pastry", "confectionery", "deli"]);

/**
 * Normalize one Overpass element into an explore_places row with group-aware
 * tags (same conventions as the city-builder importer, extended for the wider
 * coverage classes: theatres, places of worship, waterfalls, peaks, squares,
 * pedestrian streets, stadiums, bakeries…). Null for unnamed/unpositioned.
 */
export function normalizeCoverageElement(
  el: OverpassElement,
  city: string,
  country: string,
): ExplorePlaceInsert | null {
  const tags = el.tags ?? {};
  const rawName = (tags.name ?? tags["name:en"] ?? "").trim();
  if (!rawName) return null;
  // r19-portal: non-Latin names import as their English/Latin form, with the
  // original local-script name kept in nameLocal.
  const display = pickDisplayName(tags, rawName);
  const name = display.name;
  const lat = el.type === "node" ? el.lat : el.center?.lat;
  const lng = el.type === "node" ? el.lon : el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const tourism = tags.tourism ?? "";
  const historic = tags.historic ?? "";
  const amenity = tags.amenity ?? "";
  const leisure = tags.leisure ?? "";
  const natural = tags.natural ?? "";
  const shop = tags.shop ?? "";
  const place = tags.place ?? "";
  const highway = tags.highway ?? "";
  const waterway = tags.waterway ?? "";
  const manMade = tags.man_made ?? "";

  // r15-places: parking lots / rest areas are never places to visit.
  if (amenity === "parking" || isParkingLikeName(name)) return null;
  // r15-places: thrill venues get their own categories.
  const fun = funCategoryFor({ tourism, leisure });

  // Marketplaces are food ONLY when they signal prepared food (hawker, food
  // court, night market) - produce/vegetable/wholesale markets are shopping.
  const marketClass = amenity === "marketplace" ? classifyMarketplace(name, tags) : null;
  // r13-cafes: cuisine=coffee_shop marks a café even without amenity=cafe
  const coffeeShopCuisine = /(^|[;\s])coffee_shop/i.test(tags.cuisine ?? "");
  const isFood =
    marketClass != null
      ? marketClass === "food"
      : COVERAGE_FOOD_AMENITIES.has(amenity) || COVERAGE_FOOD_SHOPS.has(shop) || coffeeShopCuisine; // r13-cafes
  const category = marketClass ?? (isFood ? "food" : (fun?.category ?? "activity"));
  const isNightlife = ["bar", "pub", "nightclub", "biergarten"].includes(amenity);
  const isMusic =
    amenity === "music_venue" ||
    tourism === "theatre" ||
    amenity === "theatre" ||
    tourism === "arts_centre" ||
    amenity === "arts_centre";

  const placeTags: string[] = [];
  const pushTag = (t: string) => {
    if (!placeTags.includes(t) && placeTags.length < 4) placeTags.push(t); // cap 4 (diet:/cuisine ride along)
  };

  if (amenity === "place_of_worship") {
    const religion = tags.religion ?? "";
    const building = tags.building ?? "";
    const specific =
      religion === "muslim" || building === "mosque"
        ? "mosque"
        : religion === "christian" ||
            building === "church" ||
            building === "cathedral" ||
            building === "chapel"
          ? "church"
          : religion === "jewish"
            ? "synagogue"
            : religion === "sikh"
              ? "gurudwara"
              : "temple"; // hindu / buddhist / shinto / generic
    pushTag(specific);
    if (specific !== "temple") pushTag("temple");
  }
  if (tourism === "museum") pushTag("museum");
  if (tourism === "gallery") {
    pushTag("art");
    pushTag("museum");
  }
  if (tourism === "theatre" || amenity === "theatre") pushTag("art");
  if (tourism === "arts_centre" || amenity === "arts_centre") pushTag("art");
  if (tourism === "attraction") pushTag("landmark");
  if (tourism === "viewpoint") pushTag("views");
  // r15-places: kids' venues are family-only; thrill parks/games get the
  // fun-category tags instead of the blanket "family" bucket.
  if (tourism === "zoo" || tourism === "aquarium") pushTag("family");
  if (fun) {
    pushTag(fun.tag);
    pushTag(fun.category === "games" ? "games" : "rides");
  }
  if (historic) {
    pushTag("historic");
    if (historic === "monument" || historic === "memorial") pushTag("landmark");
    if (historic === "memorial" || historic === "statue") pushTag(historic); // statue-like
    if (historic === "church") pushTag("church");
    if (["castle", "palace", "fort", "ruins", "archaeological_site"].includes(historic)) {
      pushTag("architecture");
    }
  }
  if (tourism === "artwork") pushTag("artwork"); // statue-like: deprioritized
  if (manMade === "statue") pushTag("statue");
  if (amenity === "marketplace") {
    pushTag("market");
    pushTag(marketClass === "food" ? "food" : "shopping");
  } else if (amenity === "cafe") {
    pushTag("cafe");
    pushTag("coffee");
  } else if (amenity === "bar" || amenity === "pub") {
    pushTag("nightlife");
    pushTag("bar");
  } else if (amenity === "nightclub") {
    pushTag("nightlife");
    pushTag("club");
  } else if (amenity === "biergarten") {
    pushTag("nightlife");
    pushTag("bar");
  } else if (amenity === "music_venue") {
    pushTag("live-music");
    pushTag("nightlife");
  } else if (amenity === "restaurant") {
    pushTag("food");
    pushTag("restaurant");
  } else if (COVERAGE_FOOD_AMENITIES.has(amenity)) {
    pushTag("food");
  }
  // r13-cafes: cuisine=coffee_shop (on any amenity) reads as a café to the
  // UI's Cafés chip / coffee style - tag it like amenity=cafe.
  if (coffeeShopCuisine && amenity !== "cafe") {
    pushTag("cafe");
    pushTag("coffee");
  }
  // Dietary + cuisine signals (diet:vegetarian, diet:vegan, cuisine).
  for (const t of dietCuisineTags(tags)) pushTag(t);
  if (COVERAGE_FOOD_SHOPS.has(shop)) {
    pushTag("bakery");
    pushTag("food");
  }
  if (leisure === "park" || leisure === "garden" || leisure === "nature_reserve") pushTag("nature");
  if (leisure === "playground") pushTag("family"); // r15: water_park is a fun category now
  if (natural === "beach") {
    pushTag("beach");
    pushTag("nature");
  }
  if (natural === "peak") pushTag("peak");
  if (waterway === "waterfall") {
    pushTag("waterfall");
    pushTag("nature");
  }
  if (shop === "mall" || shop === "department_store") pushTag("shopping");
  if (shop === "marketplace") {
    pushTag("market");
    pushTag("shopping");
  }
  if (place === "square") pushTag("landmark");
  if (highway === "pedestrian") pushTag("shopping");

  const styles: string[] = [];
  const pushStyle = (s: string) => {
    if (!styles.includes(s) && styles.length < 2) styles.push(s);
  };
  if (historic || tourism === "museum" || amenity === "place_of_worship") pushStyle("historical");
  if (isFood) pushStyle("food");
  // r13-cafes: cafés also carry the extended "coffee" style (style-map.ts maps
  // it to cafe/coffee/kissaten tags) so coffee asks rank them via the column too
  if (amenity === "cafe" || coffeeShopCuisine) pushStyle("coffee");
  if (isNightlife || isMusic) pushStyle("nightlife");
  if (
    leisure === "park" ||
    leisure === "garden" ||
    leisure === "nature_reserve" ||
    natural === "beach"
  ) {
    pushStyle("relaxing");
  }
  // r15-places: zoos are family, never adventure; thrill venues are.
  if (tourism === "viewpoint" || natural === "peak") pushStyle("adventure");
  if (fun) pushStyle("adventure");
  if (tourism === "zoo" || tourism === "aquarium" || leisure === "playground") pushStyle("family");

  return {
    name: name.slice(0, 255),
    nameLocal: display.nameLocal ? display.nameLocal.slice(0, 255) : null, // r19-portal
    osmId: `${el.type}/${el.id}`,
    source: "osm",
    city,
    country,
    category,
    tags: placeTags,
    styles,
    // See overpass.ts: OSM has no ratings or price levels. NULL, not a
    // plausible-looking constant that the UI renders as real social proof.
    rating: null,
    priceLevel: null,
    feeCents: null,
    feeCurrency: null,
    feeNote: null,
    description: null,
    hidden: false,
    // r13-photos: real photo from OSM `image` / `wikimedia_commons` tags when
    // present (photoSource 'osm'); NULL keeps the stock-pool fallback.
    image: osmImageFromTags(tags), // r13-photos
    photoSource: osmImageFromTags(tags) ? "osm" : null, // r13-photos
    lat,
    lng,
  };
}

// ─── deep import ─────────────────────────────────────────────────────────────

export interface DeepImportOptions {
  /** skip Photon when the caller already knows where the city sits */
  geo?: CityGeocode;
  /** adaptive caps: big city ~180/pass, town ~80/pass (default big) */
  size?: "big" | "town";
  /** explicit per-pass cap override (wins over size) */
  capPerPass?: number;
  /** pause between Overpass passes, ms (default 1500) */
  throttleMs?: number;
  /** bbox half-span in degrees around the city center (default 0.15 ≈ 25 km) */
  deltaDeg?: number;
}

export interface DeepImportResult {
  city: string;
  country: string;
  lat: number;
  lng: number;
  inserted: number;
  total: number;
  perPass: Record<CoverageTheme, { fetched: number; inserted: number }>;
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Deep-import one city: FOUR themed Overpass passes over its bbox, merged and
 * deduped against the existing corpus in the radius (osmId, then normalized
 * name) and within the batch itself. Idempotent - re-runs insert nothing.
 * Country is resolved once per city (Photon geocode, or the caller's geo).
 */
export async function deepImportCity(
  cityInput: string,
  opts: DeepImportOptions = {},
): Promise<DeepImportResult> {
  const city = titleCase(cityInput);
  const geo = opts.geo ?? (await geocodeCity(city));
  if (!geo) throw new Error(`Could not geocode city: ${cityInput}`);

  const cap = opts.capPerPass ?? (opts.size === "town" ? 80 : 180);
  const delta = opts.deltaDeg ?? 0.15;
  const bb = `${geo.lat - delta},${geo.lng - delta},${geo.lat + delta},${geo.lng + delta}`;
  const b = radiusBbox(geo.lat, geo.lng, 25);

  // existing corpus inside the radius (dedupe targets, any approval state)
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

  const perPass = {} as DeepImportResult["perPass"];
  const rows: ExplorePlaceInsert[] = [];
  const batchOsmIds = new Set<string>();

  for (let t = 0; t < COVERAGE_THEMES.length; t++) {
    const theme = COVERAGE_THEMES[t]!;
    if (t > 0) await sleep(opts.throttleMs ?? 1_500); // polite pacing between passes
    // r13-cafes: cafés get a doubled per-pass cap (megacities have hundreds)
    const themeCap = theme.key === "cafe" ? cap * 2 : cap;
    const elements = await postCoverageQuery(theme.build(bb, themeCap));
    let insertedHere = 0;
    for (const el of elements) {
      const row = normalizeCoverageElement(el, city, geo.country);
      if (!row) continue;
      const osmId = row.osmId as string;
      if (existingOsmIds.has(osmId) || batchOsmIds.has(osmId)) continue;
      const nameKey = normName(row.name);
      if (existingNames.has(nameKey)) continue;
      batchOsmIds.add(osmId);
      existingNames.add(nameKey); // dedupe within the batch itself
      rows.push(row);
      insertedHere++;
    }
    perPass[theme.key] = { fetched: elements.length, inserted: insertedHere };
  }

  for (let i = 0; i < rows.length; i += 50) {
    await db.insert(schema.explorePlaces).values(rows.slice(i, i + 50));
  }

  const total = await corpusCountNear(geo.lat, geo.lng, 25);
  return {
    city,
    country: geo.country,
    lat: geo.lat,
    lng: geo.lng,
    inserted: rows.length,
    total,
    perPass,
  };
}
