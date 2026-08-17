/**
 * City Builder (OSM group itineraries) - backs /city/:name.
 *
 * `cityProfile` geocodes ANY city on Earth (Photon), lazily bulk-imports its
 * OpenStreetMap places into explore_places when the local corpus within ~25 km
 * is thin (< 12 places), then returns the places grouped by OSM-derived
 * classifications (temples, food, cafes, parks, beaches, …) so travelers can
 * hand-pick places into a bucket list or a new trip.
 *
 * The shared importer (queries/overpass.ts importCityPlaces) deliberately
 * covers only a handful of OSM categories; the city builder needs worship
 * places, beaches, shopping, pubs and playgrounds too, so this module runs
 * its own wider Overpass query with its own tag mapping. Rows are written
 * with the same conventions (source 'osm', osmId + normalized-name dedupe),
 * so both importers stay idempotent against each other in either order.
 *
 * `requestCityAI` records a "bring AI itineraries to this city" vote into
 * city_requests for the admin team (deduped per user+city).
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import {
  classifyMarketplace,
  geocodeCity,
  titleCase,
  type OverpassElement,
  type OverpassResponse,
} from "./queries/overpass";
import {
  cacheGet,
  cacheSet,
  corpusPoints,
  countWithin,
  makePointIndex,
} from "./queries/coverage";
import { WORLD_COUNTRIES } from "./lib/world-cities";
import { isGenericName, isParkingLikeName } from "./lib/place-quality";
import { funCategoryFor } from "./lib/classify-place"; // r15-places
import { authedQuery, createRouter } from "./middleware";
import { fetchJson } from "./lib/http";

/** cityProfile payload cache - 24h; the imported places themselves live
 * permanently in explore_places, so only the assembled payload is cached. */

const USER_AGENT = "Wayfare/1.0 (travel app; OSM city builder)";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Corpus radius that defines "this city is covered" - ~25 km around the geocoded center. */
const CITY_RADIUS_KM = 25;
/** Below this many corpus places inside the radius we import from Overpass first. */
const MIN_CORPUS_PLACES = 12;
/** Cap of places returned per group (top by rating). */
const GROUP_LIMIT = 24;

/** Great-circle distance in km (haversine). */
function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Lat/lng bounding box containing the `radiusKm` circle around a point. */
function radiusBbox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / 111.32;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusKm / (111.32 * cosLat);
  return { s: lat - dLat, n: lat + dLat, w: lng - dLng, e: lng + dLng };
}

// ─── Group taxonomy (OSM classifications → traveler-facing groups) ──────────

type GroupKey =
  | "temples"
  | "landmarks"
  | "museums"
  | "food"
  | "cafes"
  | "parks"
  | "beaches"
  | "viewpoints"
  | "shopping"
  | "nightlife"
  | "family"
  | "themeparks" // r15-places
  | "games"; // r15-places

interface GroupDef {
  key: GroupKey;
  label: string;
  emoji: string;
  /** tag set (corpus tags, lowercase) that assigns a place to this group */
  tags: ReadonlySet<string>;
}

/**
 * Display order (mission spec). Assignment uses ASSIGN_ORDER below so that
 * specialized tags (temple, bar, cafe) win over the generic food bucket.
 */
export const CITY_GROUPS: GroupDef[] = [
  {
    key: "temples",
    label: "Temples & shrines",
    emoji: "🛕",
    tags: new Set([
      "temple", "shrine", "church", "mosque", "cathedral", "basilica", "chapel",
      "monastery", "pagoda", "buddha", "gurudwara", "synagogue", "place_of_worship", "religious",
    ]),
  },
  {
    key: "landmarks",
    label: "Landmarks & monuments",
    emoji: "🗽",
    tags: new Set([
      "landmark", "monument", "memorial", "castle", "fort", "palace", "ruins",
      "tower", "arch", "iconic", "statues", "fountain", "historic", "architecture", "heritage",
    ]),
  },
  {
    key: "museums",
    label: "Museums & galleries",
    emoji: "🏛️",
    tags: new Set(["museum", "gallery", "art", "antiquities"]),
  },
  {
    key: "food",
    label: "Restaurants & food",
    emoji: "🍽️",
    tags: new Set([
      "food", "restaurant", "street-food", "seafood", "dinner", "lunch", "tacos",
      "ramen", "sushi", "bakery", "indian", "local-favorite", "casual",
    ]),
  },
  {
    key: "cafes",
    label: "Cafés & coffee",
    emoji: "☕",
    tags: new Set(["cafe", "coffee", "tea", "kissaten", "brunch", "breakfast"]),
  },
  {
    key: "parks",
    label: "Parks & nature",
    emoji: "🌳",
    tags: new Set(["park", "garden", "gardens", "nature", "picnic", "waterfall", "lake", "river"]),
  },
  {
    key: "beaches",
    label: "Beaches",
    emoji: "🏖️",
    tags: new Set(["beach", "beachfront", "seaside", "snorkel", "swimming"]),
  },
  {
    key: "viewpoints",
    label: "Viewpoints",
    emoji: "🌇",
    tags: new Set(["viewpoint", "views", "observatory", "skyline", "sunset", "peak", "photography"]),
  },
  {
    key: "shopping",
    label: "Shopping & markets",
    emoji: "🛍️",
    tags: new Set(["shopping", "mall", "market", "markets", "souk", "bazaar", "night-market", "haggling"]),
  },
  {
    key: "nightlife",
    label: "Bars & nightlife",
    emoji: "🍸",
    tags: new Set(["nightlife", "bar", "pub", "cocktails", "club", "wine-bar", "drinks", "late-night"]),
  },
  {
    key: "family",
    label: "Family & kids",
    emoji: "🎡",
    tags: new Set(["family", "zoo", "aquarium", "playground", "theme-park", "rides", "planetarium"]),
  },
  // r15-places: thrill venues get their own chips instead of lumping into
  // Family & kids - theme/water parks first, then the games venues.
  {
    key: "themeparks",
    label: "Theme & water parks",
    emoji: "🎢",
    tags: new Set(["theme-park", "water-park", "rides", "themepark", "waterpark", "amusement"]),
  },
  {
    key: "games",
    label: "Games & fun",
    emoji: "🎮",
    tags: new Set(["games", "arcade", "go-kart", "paintball", "bowling", "escape-room", "laser-tag"]),
  },
];

/**
 * Assignment priority - first matching group wins. Specialized tags beat the
 * generic buckets: a bar (food + nightlife) lands in Nightlife, a café in
 * Cafés, a market (market + food) in Shopping; plain restaurants fall through
 * to Food, which is the only group that also matches on category === 'food'.
 */
const ASSIGN_ORDER: GroupKey[] = [
  "temples",
  "museums",
  "landmarks",
  "viewpoints",
  "beaches",
  "shopping",
  "nightlife",
  "cafes",
  "themeparks",
  "games",
  "family",
  "parks",
  "food",
];

const GROUP_BY_KEY = new Map(CITY_GROUPS.map((g) => [g.key, g]));

/** r15-places: fun categories bucket into their own groups by category too. */
const CATEGORY_GROUP: Record<string, GroupKey> = {
  themepark: "themeparks",
  waterpark: "themeparks",
  games: "games",
};

// exported for unit tests (r16-culinary: café group split coverage)
export function groupKeyFor(place: { category: string; tags: string[] | null }): GroupKey | null {
  const tags = (place.tags ?? []).map((t) => t.toLowerCase());
  const catGroup = CATEGORY_GROUP[place.category.toLowerCase()];
  for (const key of ASSIGN_ORDER) {
    const def = GROUP_BY_KEY.get(key)!;
    if (key === "food") {
      if (place.category === "food" || tags.some((t) => def.tags.has(t))) return "food";
    } else if (tags.some((t) => def.tags.has(t)) || catGroup === key) {
      return key;
    }
  }
  return null;
}

// ─── Wide Overpass import (city-builder coverage) ────────────────────────────

/**
 * Superset of the shared city query: adds places of worship, beaches, shops,
 * pubs/fast food, playgrounds and artwork - the OSM classifications the city
 * builder groups by. ~0.15° bbox ≈ the corpus radius.
 */
function buildCityBuilderQuery(b: { s: number; w: number; n: number; e: number }): string {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  return `[out:json][timeout:25];
(
  node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court|marketplace|ice_cream)$"](${bb});
  node["amenity"="place_of_worship"](${bb});
  node["tourism"~"^(museum|attraction|gallery|viewpoint|zoo|aquarium|theme_park|artwork)$"](${bb});
  node["historic"~"^(castle|monument|palace|fort|ruins|archaeological_site|memorial|church)$"](${bb});
  node["leisure"~"^(park|garden|nature_reserve|playground|water_park|amusement_arcade|escape_game|go_kart|paintball|bowling_alley)$"](${bb});
  node["natural"="beach"](${bb});
  node["shop"~"^(mall|marketplace)$"](${bb});
  way["amenity"~"^(restaurant|cafe|bar|pub|marketplace|place_of_worship)$"](${bb});
  way["tourism"~"^(museum|attraction|gallery|viewpoint|zoo|aquarium|theme_park)$"](${bb});
  way["historic"~"^(castle|monument|palace|fort|ruins|archaeological_site|memorial)$"](${bb});
  way["leisure"~"^(park|garden|nature_reserve|playground|water_park|amusement_arcade|escape_game|go_kart|paintball|bowling_alley)$"](${bb});
  way["natural"="beach"](${bb});
  way["shop"~"^(mall|marketplace)$"](${bb});
);
out center tags 400;`;
}

async function postOverpass(query: string): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const data = await fetchJson<OverpassResponse>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 30000,
        userAgent: USER_AGENT,
        service: "overpass",
      });
      if (!Array.isArray(data.elements)) throw new Error("Overpass returned no elements array");
      return data.elements;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass request failed");
}

type ExplorePlaceInsert = typeof schema.explorePlaces.$inferInsert;

const FOOD_AMENITIES = new Set([
  "restaurant",
  "cafe",
  "bar",
  "pub",
  "fast_food",
  "food_court",
  "marketplace",
  "ice_cream",
]);

/**
 * Normalize one Overpass element into an explore_places row with GROUP-AWARE
 * tags (temple / church / mosque / restaurant / cafe / bar / beach /
 * shopping / playground …) so cityProfile can bucket it by OSM class.
 * Returns null for unnamed/unpositioned elements.
 */
export function normalizeCityElement(
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

  const tourism = tags.tourism ?? "";
  const historic = tags.historic ?? "";
  const amenity = tags.amenity ?? "";
  const leisure = tags.leisure ?? "";
  const natural = tags.natural ?? "";
  const shop = tags.shop ?? "";
  // r15-places: parking lots / rest areas are never places to visit.
  if (amenity === "parking" || isParkingLikeName(name)) return null;
  // r15-places: marketplaces are food ONLY when they signal prepared food -
  // vegetable/wholesale markets are shopping (shared classifier rule).
  const marketClass = amenity === "marketplace" ? classifyMarketplace(name, tags) : null;
  // r15-places: thrill venues get their own categories.
  const fun = funCategoryFor({ tourism, leisure });
  const category =
    marketClass ?? (FOOD_AMENITIES.has(amenity) && amenity !== "marketplace" ? "food" : (fun?.category ?? "activity"));

  const placeTags: string[] = [];
  const pushTag = (t: string) => {
    if (!placeTags.includes(t) && placeTags.length < 3) placeTags.push(t);
  };

  if (amenity === "place_of_worship") {
    const religion = tags.religion ?? "";
    const building = tags.building ?? "";
    const specific =
      religion === "muslim" || building === "mosque"
        ? "mosque"
        : religion === "christian" || building === "church" || building === "cathedral" || building === "chapel"
          ? "church"
          : religion === "jewish"
            ? "synagogue"
            : religion === "sikh"
              ? "gurudwara"
              : "temple"; // hindu / buddhist / shinto / generic
    pushTag(specific);
    if (specific !== "temple") pushTag("temple"); // generic pool: grouping + photo fallback
  }
  if (tourism === "museum") pushTag("museum");
  if (tourism === "gallery") {
    pushTag("art");
    pushTag("museum");
  }
  if (tourism === "attraction") pushTag("landmark");
  if (tourism === "artwork") {
    pushTag("art");
    pushTag("landmark");
  }
  if (tourism === "viewpoint") pushTag("views");
  // r15-places: kids' venues are family-only; thrill parks/games get the
  // fun-category tags (theme-park/water-park/rides, games vocabulary).
  if (tourism === "zoo" || tourism === "aquarium") pushTag("family");
  if (fun) {
    pushTag(fun.tag);
    pushTag(fun.category === "games" ? "games" : "rides");
  }
  if (historic) {
    pushTag("historic");
    if (historic === "monument" || historic === "memorial") pushTag("landmark");
    if (historic === "church") pushTag("church");
    if (["castle", "palace", "fort", "ruins", "archaeological_site"].includes(historic)) {
      pushTag("architecture");
    }
  }
  if (amenity === "marketplace") {
    pushTag("market");
    pushTag(marketClass === "food" ? "food" : "shopping"); // r15: produce markets aren't food
  } else if (amenity === "cafe") {
    pushTag("cafe");
    pushTag("coffee");
  } else if (amenity === "bar" || amenity === "pub") {
    pushTag("nightlife");
    pushTag("bar");
  } else if (amenity === "restaurant") {
    pushTag("food");
    pushTag("restaurant");
  } else if (FOOD_AMENITIES.has(amenity)) {
    pushTag("food");
  }
  if (leisure === "park" || leisure === "garden" || leisure === "nature_reserve") pushTag("nature");
  if (leisure === "playground") pushTag("family");
  if (natural === "beach") {
    pushTag("beach");
    pushTag("nature");
  }
  if (shop === "mall") {
    pushTag("shopping");
    pushTag("market");
  }
  if (shop === "marketplace") {
    pushTag("market");
    pushTag("shopping");
  }

  const styles: string[] = [];
  const pushStyle = (s: string) => {
    if (!styles.includes(s) && styles.length < 2) styles.push(s);
  };
  if (historic || tourism === "museum" || amenity === "place_of_worship") pushStyle("historical");
  if (category === "food") pushStyle("food"); // r15: marketplaces aren't automatically food
  if (
    leisure === "park" ||
    leisure === "garden" ||
    leisure === "nature_reserve" ||
    natural === "beach"
  ) {
    pushStyle("relaxing");
  }
  // r15-places: zoos are family, never adventure; thrill venues are.
  if (tourism === "viewpoint") pushStyle("adventure");
  if (fun) pushStyle("adventure");
  if (tourism === "zoo" || tourism === "aquarium" || leisure === "playground") pushStyle("family");

  return {
    name: name.slice(0, 255),
    osmId: `${el.type}/${el.id}`,
    source: "osm",
    city,
    country,
    category,
    tags: placeTags,
    styles,
    // r25: OSM has no rating/price data - see overpass.ts.
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

/** Fetch every approved corpus place inside the radius around (lat,lng). */
async function placesNear(lat: number, lng: number, radiusKm = CITY_RADIUS_KM) {
  const b = radiusBbox(lat, lng, radiusKm);
  const rows = await getDb()
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
    );
  return rows.filter(
    (p) => p.lat != null && p.lng != null && kmBetween(lat, lng, p.lat, p.lng) <= radiusKm,
  );
}

/**
 * Wide OSM import for the city builder. Dedupes against corpus rows already
 * inside the radius (osmId, or same normalized name) - idempotent, and
 * compatible with the shared importCityPlaces in either run order.
 */
export async function importCityBuilderPlaces(
  city: string,
  geo: { lat: number; lng: number; country: string },
): Promise<{ inserted: number }> {
  const elements = await postOverpass(
    buildCityBuilderQuery({
      s: geo.lat - 0.15,
      w: geo.lng - 0.15,
      n: geo.lat + 0.15,
      e: geo.lng + 0.15,
    }),
  );

  const existing = await placesNear(geo.lat, geo.lng);
  const existingOsmIds = new Set(existing.map((r) => r.osmId).filter((v): v is string => v != null));
  const existingNames = new Set(existing.map((r) => normalizeName(r.name)));

  const rows: ExplorePlaceInsert[] = [];
  const batchOsmIds = new Set<string>();
  for (const el of elements) {
    const row = normalizeCityElement(el, city, geo.country);
    if (!row) continue;
    const osmId = row.osmId as string;
    if (existingOsmIds.has(osmId) || batchOsmIds.has(osmId)) continue;
    const nameKey = normalizeName(row.name);
    if (existingNames.has(nameKey)) continue;
    batchOsmIds.add(osmId);
    existingNames.add(nameKey); // dedupe within the batch itself
    rows.push(row);
  }

  const db = getDb();
  for (let i = 0; i < rows.length; i += 50) {
    await db.insert(schema.explorePlaces).values(rows.slice(i, i + 50));
  }
  return { inserted: rows.length };
}

// ─── cityProfile payload loader (wrapped in a 24 h api_cache entry) ─────────

/**
 * Full cityProfile computation: geocode, lazy-import when the corpus is thin,
 * group the radius places. Extracted so the query can cache the final payload
 * (`cityprof:{norm}`, 24 h) and repeat visits are instant.
 */
async function loadCityProfile(city: string) {
  const geo = await geocodeCity(city);
  if (!geo) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `We couldn't find “${city}” on the map, check the spelling or try a nearby larger town.`,
    });
  }

  let places = await placesNear(geo.lat, geo.lng);
  let imported = 0;
  if (places.length < MIN_CORPUS_PLACES) {
    try {
      const res = await importCityBuilderPlaces(city, geo);
      imported = res.inserted;
    } catch {
      // Overpass unavailable - serve whatever the corpus already has
    }
    if (imported > 0) places = await placesNear(geo.lat, geo.lng);
  }

  const byGroup = new Map<GroupKey, schema.ExplorePlace[]>();
  for (const p of places) {
    // Hide OSM placeholder-named rows ("Park", "Central Market",
    // "Sightseeing") from the group listings - rows stay in the corpus.
    if (isGenericName(p.name)) continue;
    const key = groupKeyFor(p);
    if (!key) continue;
    const list = byGroup.get(key) ?? [];
    list.push(p);
    byGroup.set(key, list);
  }

  const groups = CITY_GROUPS.filter((def) => byGroup.has(def.key)).map((def) => {
    const list = byGroup.get(def.key)!;
    list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name));
    return {
      key: def.key,
      label: def.label,
      emoji: def.emoji,
      count: list.length,
      places: list.slice(0, GROUP_LIMIT),
    };
  });

  return {
    city,
    country: geo.country,
    lat: geo.lat,
    lng: geo.lng,
    total: places.length,
    imported,
    groups,
  };
}

type CityProfilePayload = Awaited<ReturnType<typeof loadCityProfile>>;

/** One country row of the worldDirectory payload. */
export interface WorldDirectoryCountry {
  code: string;
  country: string;
  region: string;
  cities: { name: string; mapped: boolean; placeCount: number }[];
}

const CITY_PROFILE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const WORLD_DIRECTORY_TTL_MS = 6 * 60 * 60 * 1000; // 6 h

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * Assemble the cityProfile payload: geocode the city, lazily import from
 * Overpass when the local corpus is thin, then bucket every approved place
 * in the radius into the traveler-facing groups. Called through the 24h
 * `cityprof:` cache - it only re-runs for a cold/expired key.
 */

export const citybuildRouter = createRouter({
  /**
   * Grouped OSM profile for any city on Earth. Geocodes the city, imports
   * from Overpass when the local corpus is thin (< MIN_CORPUS_PLACES within
   * 25 km), then buckets every approved place in the radius into the
   * traveler-facing groups. The final payload is cached 24 h in api_cache, so
   * repeat visits (and "map it now" clicks from the world directory) are
   * instant; a thin payload from a failed import is NOT cached, so the next
   * call retries the import.
   */
  cityProfile: authedQuery
    .input(z.object({ city: z.string().trim().min(2).max(120) }))
    .query(async ({ input }) => {
      const city = titleCase(input.city);
      // v2: payloads now carry famousEatery on every place row (r15-eats) -
      // don't serve pre-flag cache entries.
      const cacheKey = `cityprof2:${normalizeName(city)}`;
      const cached = await cacheGet<CityProfilePayload>(cacheKey);
      if (cached) return cached;

      const payload = await loadCityProfile(city);
      // Cache healthy payloads; when the corpus is still thin AND the import
      // failed (Overpass outage), leave it uncached so the next call retries.
      if (payload.total >= MIN_CORPUS_PLACES || payload.imported > 0) {
        await cacheSet(cacheKey, payload, CITY_PROFILE_TTL_MS);
      }
      return payload;
    }),

  /**
   * World city directory (missions J/K): every country with its capital +
   * top cities by population (max 25 each, grouped by region client-side).
   * `mapped` = the corpus already holds ≥ 12 approved places within 25 km of
   * the city; unmapped cities are still listed so the UI can offer a
   * "coming soon - map it now" state that triggers cityProfile's on-demand
   * import. The whole payload is cached 6 h in api_cache.
   */
  worldDirectory: authedQuery.query(async () => {
    const cacheKey = "worlddir:v1";
    const cached = await cacheGet<WorldDirectoryCountry[]>(cacheKey);
    if (cached) return cached;

    const index = makePointIndex(await corpusPoints());
    const payload: WorldDirectoryCountry[] = WORLD_COUNTRIES.map((c) => ({
      code: c.code,
      country: c.name,
      region: c.region,
      cities: c.cities.map((city) => {
        const placeCount =
          city.lat != null && city.lng != null ? countWithin(index, city.lat, city.lng, 25) : 0;
        return { name: city.name, mapped: placeCount >= MIN_CORPUS_PLACES, placeCount };
      }),
    }));
    await cacheSet(cacheKey, payload, WORLD_DIRECTORY_TTL_MS);
    return payload;
  }),

  /**
   * "Bring AI itineraries to this city" - one row per (user, city) in
   * city_requests; a repeat request returns { already: true } instead of
   * throwing so the UI can show an "Already requested" state.
   */
  requestCityAI: authedQuery
    .input(
      z.object({
        city: z.string().trim().min(2).max(255),
        country: z.string().trim().max(255).optional(),
        message: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const city = titleCase(input.city);
      const db = getDb();
      const existing = await db
        .select({ id: schema.cityRequests.id })
        .from(schema.cityRequests)
        .where(and(eq(schema.cityRequests.userId, ctx.user.id), eq(schema.cityRequests.city, city)))
        .limit(1);
      if (existing[0]) return { ok: true as const, already: true as const };

      try {
        await db.insert(schema.cityRequests).values({
          userId: ctx.user.id,
          city,
          country: input.country ?? null,
          message: input.message || null,
          status: "pending",
        });
      } catch (e) {
        // Lost a race against the unique index - treat as already requested.
        const code = (e as { cause?: { errno?: number } })?.cause?.errno;
        if (code === 1062) return { ok: true as const, already: true as const };
        throw e;
      }
      return { ok: true as const, already: false as const };
    }),
});
