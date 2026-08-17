/**
 * Open map data ingestion: Photon (geocoding + place search) and Overpass
 * (bulk city discovery). Shared by `explore.discover` and `db/seed-overpass.ts`.
 * Data © OpenStreetMap contributors, ODbL.
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { cacheHash, cacheKey, cachedJson } from "../lib/cache";
import { fetchJson } from "../lib/http";
import { osmImageFromTags } from "../lib/osm-photo"; // r13-photos
import { isParkingLikeName } from "../lib/place-quality"; // r15-places
import { pickDisplayName } from "../lib/latin-name"; // r19-portal
import {
  funCategoryFor,
  PREPARED_FOOD_MARKET_RE,
  PRODUCE_MARKET_RE,
} from "../lib/classify-place"; // r15-places

// ── Persistent cache TTLs (api/lib/cache.ts; api_cache table) ───────────────
// Photon geocoding/search/reverse are essentially static → 30 days.
// Overpass POI responses change slowly → 7 days.
// NOTE: explore_places INSERTS are already persistent rows - import results
// are deliberately NOT cached here (that would double-cache).
const TTL_PHOTON = 30 * 24 * 60 * 60 * 1000;
const TTL_OVERPASS = 7 * 24 * 60 * 60 * 1000;

/** Normalize free text for cache keys (case/whitespace-insensitive). */
function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Round coordinates for cache keys (3dp ≈ 110 m - plenty for city-level data). */
function coord3(n: number): string {
  return n.toFixed(3);
}

// ── Photon types ─────────────────────────────────────────────────────────────
export interface PhotonProperties {
  osm_id?: number;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
  countrycode?: string;
}

export interface PhotonFeature {
  type: string;
  properties: PhotonProperties;
  geometry: { type: string; coordinates: [number, number] };
}

export interface PhotonResponse {
  type: string;
  features: PhotonFeature[];
}

// ── Overpass types ───────────────────────────────────────────────────────────
export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  version?: number;
  generator?: string;
  elements: OverpassElement[];
}

export interface Bbox {
  s: number;
  w: number;
  n: number;
  e: number;
}

export interface CityGeocode {
  lat: number;
  lng: number;
  country: string;
  /** Matched feature's own name/state when known (validated lookups). */
  name?: string;
  state?: string;
}

export interface OsmSearchHit {
  id: null;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  category: string;
  address: string;
  source: "osm";
}

export interface ImportCityResult {
  inserted: number;
  total: number;
}

const PHOTON_API = "https://photon.komoot.io/api/";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "Wayfare/1.0 (travel app; OSM data import)";

const FOOD_OSM_VALUES = new Set(["restaurant", "cafe", "bar", "fast_food", "food_court", "marketplace", "ice_cream", "juice_bar"]); // r13-cafes: +ice_cream/juice_bar
// r13-cafes: bakery-class shops are food (single-pass import now fetches them)
const BAKERY_SHOP_VALUES = new Set(["bakery", "pastry", "confectionery"]);

// ── Marketplace classification ───────────────────────────────────────────────
// amenity=marketplace covers everything from hawker centres to wholesale
// vegetable mandis. Blanket-mapping all of them to 'food' is how "vegetable
// markets" ended up suggested as restaurants - only prepared-food markets are
// food; produce/wholesale/ambiguous markets are 'shopping'.
// r15-places: the regexes live in api/lib/classify-place.ts so the corpus
// repair pass (db/fix-classification.ts) applies the exact same rules.
export { PREPARED_FOOD_MARKET_RE, PRODUCE_MARKET_RE };

/**
 * Classify an amenity=marketplace element: 'food' only when the name/tags
 * signal prepared food (food court, hawker, street food, night market, food
 * hall, a cuisine tag); produce/wholesale/vegetable/fish markets - and
 * ambiguous ones - classify as 'shopping'.
 */
export function classifyMarketplace(
  name: string,
  tags: Record<string, string> = {},
): "food" | "shopping" {
  const hay = [name, tags.cuisine, tags["market:type"], tags.description]
    .filter(Boolean)
    .join(" ");
  if (PREPARED_FOOD_MARKET_RE.test(hay)) return "food";
  if (tags["market:type"] === "food") return "food";
  if (tags.cuisine) return "food"; // a marketplace tagged with cuisine serves prepared food
  if (PRODUCE_MARKET_RE.test(hay)) return "shopping";
  return "shopping";
}

/** Dietary/cuisine signals captured into place tags (diet:*, cuisine). */
export function dietCuisineTags(tags: Record<string, string>): string[] {
  const out: string[] = [];
  if (/^(yes|only)$/i.test(tags["diet:vegetarian"] ?? "")) out.push("vegetarian");
  if (/^(yes|only)$/i.test(tags["diet:vegan"] ?? "")) out.push("vegan");
  const cuisine = (tags.cuisine ?? "").split(";")[0]!.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (cuisine && cuisine !== "no" && cuisine.length <= 24) out.push(cuisine);
  return out;
}

/** Statue-like OSM classes - tagged so ranking can deprioritize them. */
export const STATUE_OSM = {
  historic: new Set(["memorial", "statue"]),
  tourism: new Set(["artwork"]),
  manMade: new Set(["statue"]),
};

/** "new york" → "New York" (per-word, keeps single-word input intact). */
export function titleCase(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/**
 * Geocode a city name with Photon. Fetches several candidates and prefers
 * settlement-like features (city > town > … > region) because Photon's raw
 * ranking sometimes surfaces small same-name towns first (e.g. "Lisbon, Iowa").
 * Returns null on any failure - callers treat that as "cannot geocode".
 * Successful lookups are cached 30d in api_cache (`geo:gc:{normalized city}`).
 */
/**
 * Junk-string guard: route paths ("/friends"), slashes, control chars and
 * letter-less strings are never place names. Photon's fuzzy matcher happily
 * resolves them to random features ("/friends" once geocoded to the Epcot
 * ride "The Seas with Nemo & Friends" and poisoned 677 corpus rows with
 * city="/friends"), so reject BEFORE geocoding or caching.
 */
export function isPlausiblePlaceQuery(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 120) return false;
  if (/[/\\\p{C}]/u.test(t)) return false;
  return /\p{L}/u.test(t); // must contain at least one letter
}

export function geocodeCity(city: string): Promise<CityGeocode | null> {
  if (!isPlausiblePlaceQuery(city)) return Promise.resolve(null);
  return cachedJson(cacheKey("geo:gc:", normText(city)), TTL_PHOTON, () =>
    geocodeCityUncached(city),
  );
}

async function geocodeCityUncached(city: string): Promise<CityGeocode | null> {
  try {
    const url = new URL(PHOTON_API);
    url.searchParams.set("q", city);
    url.searchParams.set("limit", "10");
    url.searchParams.set("lang", "en");
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 6000,
      userAgent: USER_AGENT,
      service: "photon",
    });
    if (!Array.isArray(data.features) || data.features.length === 0) return null;
    const PRIORITY = [
      "city",
      "town",
      "village",
      "municipality",
      "borough",
      "province",
      "county",
      "region",
      "district",
      "state",
      "locality",
    ];
    let best: PhotonFeature | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const f of data.features) {
      const v = f.properties.osm_value ?? "";
      const idx = PRIORITY.indexOf(v);
      const score = idx === -1 ? PRIORITY.length + 1 : idx;
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const feat = best ?? data.features[0]!;
    const [lng, lat] = feat.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng, country: feat.properties.country ?? "" };
  } catch {
    return null;
  }
}

/**
 * Country-scoped, name-validated geocode (r11 corridor guard). Plain Photon
 * fuzzy matching will cheerfully resolve "Mumbai, Philippines" to Digos -
 * a hit in the right country with the wrong name is useless for endpoint
 * disambiguation. Here a feature only counts when (a) its country matches
 * `country` (case-insensitive) and (b) one of its name fields fuzzy-matches
 * the query core. Returns null when nothing validates. Cached 30d
 * (`geo:gcin:{country}:{city}`).
 */
export function geocodeCityInCountry(
  city: string,
  country: string,
): Promise<CityGeocode | null> {
  return cachedJson(
    cacheKey("geo:gcin:", `${normText(country)}:${normText(city)}`),
    TTL_PHOTON,
    () => geocodeCityInCountryUncached(city, country),
  );
}

async function geocodeCityInCountryUncached(
  city: string,
  country: string,
): Promise<CityGeocode | null> {
  try {
    const url = new URL(PHOTON_API);
    url.searchParams.set("q", `${city}, ${country}`);
    url.searchParams.set("limit", "15");
    url.searchParams.set("lang", "en");
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 6000,
      userAgent: USER_AGENT,
      service: "photon",
    });
    if (!Array.isArray(data.features) || data.features.length === 0) return null;
    const wantCountry = normText(country);
    const core = normText(city);
    const valid = data.features.filter((f) => {
      const p = f.properties;
      if (normText(p.country ?? "") !== wantCountry) return false;
      const names = [p.name, p.city, p.town, p.village, p.district, p.state]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .map((x) => normText(x));
      return names.some((n) => n.includes(core) || core.includes(n));
    });
    if (valid.length === 0) return null;
    const PRIORITY = [
      "city",
      "town",
      "village",
      "municipality",
      "borough",
      "province",
      "county",
      "region",
      "district",
      "state",
      "locality",
    ];
    let best = valid[0]!;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const f of valid) {
      const idx = PRIORITY.indexOf(f.properties.osm_value ?? "");
      const score = idx === -1 ? PRIORITY.length + 1 : idx;
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const [lng, lat] = best.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return {
      lat,
      lng,
      country: best.properties.country ?? "",
      name: best.properties.name,
      state: best.properties.state,
    };
  } catch {
    return null;
  }
}

/**
 * Photon place search for `explore.search`. Throws on failure - caller falls
 * back to corpus-only. Responses are cached 30d in api_cache
 * (`geo:ps:{normalized query}|{lat,lng @3dp}|{limit}`).
 */
export function searchPhoton(
  query: string,
  near?: { lat: number; lng: number },
  limit = 8,
): Promise<OsmSearchHit[]> {
  const nearKey = near ? `${coord3(near.lat)},${coord3(near.lng)}` : "";
  return cachedJson(
    cacheKey("geo:ps:", `${normText(query)}|${nearKey}|${limit}`),
    TTL_PHOTON,
    () => searchPhotonUncached(query, near, limit),
  );
}

async function searchPhotonUncached(
  query: string,
  near?: { lat: number; lng: number },
  limit = 8,
): Promise<OsmSearchHit[]> {
  const url = new URL(PHOTON_API);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  if (near) {
    url.searchParams.set("lat", String(near.lat));
    url.searchParams.set("lon", String(near.lng));
  }
  const data = await fetchJson<PhotonResponse>(url, {
    timeoutMs: 4000,
    userAgent: USER_AGENT,
    service: "photon",
  });
  if (!Array.isArray(data.features)) return [];
  const hits: OsmSearchHit[] = [];
  for (const f of data.features) {
    const p = f.properties;
    const name = (p.name ?? "").trim();
    if (!name) continue;
    const [lng, lat] = f.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const category =
      p.osm_key === "amenity" && p.osm_value === "marketplace"
        ? classifyMarketplace(name, {}) === "food"
          ? "food"
          : "activity"
        : p.osm_key === "amenity" && FOOD_OSM_VALUES.has(p.osm_value ?? "")
          ? "food"
          : "activity";
    const address = [p.street, p.housenumber, p.district].filter(Boolean).join(", ");
    hits.push({
      id: null,
      name: name.slice(0, 255),
      city: p.city ?? p.town ?? p.village ?? "",
      country: p.country ?? "",
      lat,
      lng,
      category,
      address,
      source: "osm",
    });
  }
  return hits;
}

export interface PhotonCityHit {
  name: string;
  country: string;
  state: string;
  lat: number;
  lng: number;
}

/** Settlement osm_values accepted as "a city you can open in the city builder". */
const CITY_OSM_VALUES = ["city", "town", "village", "municipality", "borough", "district", "suburb"];

/** Diacritics/whitespace/case-folded key so "São Paulo" matches "sao paulo". */
function foldCityName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

}

/**
 * Worldwide city search for the global ⌘K palette (explore.globalSearch):
 * Photon settlement features whose folded name genuinely matches the query -
 * that relevance check is what keeps gibberish ("zzzqqq") honest instead of
 * returning Photon's best guess. Never throws: returns [] when Photon is
 * unreachable or nothing relevant exists.
 */
export async function searchPhotonCities(query: string, limit = 4): Promise<PhotonCityHit[]> {
  try {
    const url = new URL(PHOTON_API);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "12");
    url.searchParams.set("lang", "en");
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 4000,
      userAgent: USER_AGENT,
      service: "photon",
    });
    if (!Array.isArray(data.features)) return [];
    const needle = foldCityName(query);
    if (!needle) return [];
    const out: PhotonCityHit[] = [];
    const seen = new Set<string>();
    for (const f of data.features) {
      const p = f.properties;
      const name = (p.name ?? "").trim();
      if (!name || !CITY_OSM_VALUES.includes(p.osm_value ?? "")) continue;
      const foldedName = foldCityName(name);
      if (!foldedName.includes(needle) && !needle.includes(foldedName)) continue;
      const [lng, lat] = f.geometry.coordinates;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      const key = `${foldedName}@${(p.country ?? "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: name.slice(0, 120), country: p.country ?? "", state: p.state ?? "", lat, lng });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function bboxAround(lat: number, lng: number, deltaDeg = 0.15): Bbox {
  return { s: lat - deltaDeg, w: lng - deltaDeg, n: lat + deltaDeg, e: lng + deltaDeg };
}

// r13-cafes: food coverage widened - fast_food/ice_cream/juice_bar amenities,
// bakery-class shops and cuisine=coffee_shop now come along in the single pass.
export function buildOverpassQuery(b: Bbox): string {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  return `[out:json][timeout:25];
(
  node["tourism"~"museum|attraction|gallery|viewpoint|zoo|aquarium|theme_park"](${bb});
  node["historic"~"castle|monument|palace|fort|ruins|archaeological_site|memorial"](${bb});
  node["amenity"~"restaurant|cafe|marketplace|food_court|bar|pub|fast_food|ice_cream|juice_bar"](${bb});
  node["shop"~"^(bakery|pastry|confectionery)$"](${bb});
  node["cuisine"~"coffee_shop"](${bb});
  node["leisure"~"park|garden|nature_reserve|water_park|amusement_arcade|escape_game|go_kart|paintball|bowling_alley"](${bb});
  way["tourism"~"museum|attraction|gallery|zoo|aquarium|theme_park"](${bb});
  way["historic"~"castle|monument|palace|fort|ruins|archaeological_site"](${bb});
  way["leisure"~"park|garden|nature_reserve|water_park|amusement_arcade|escape_game|go_kart|paintball|bowling_alley"](${bb});
);
out center tags 250;`;
}

// ── Nearby (around:) search - backs explore.nearby ──────────────────────────

export type NearbyKind = "food" | "activity" | "all";

/** Food amenities queried by explore.nearby (spec: restaurant|cafe|bar|fast_food|pub|food_court). */
export const NEARBY_FOOD_AMENITIES = new Set([
  "restaurant",
  "cafe",
  "bar",
  "fast_food",
  "pub",
  "food_court",
]);

/**
 * Overpass `around:` query for named POIs within `radiusM` of a point.
 * Food → amenity nodes; activity → tourism + leisure(park/garden) + historic.
 * `out center tags 40` caps the payload at 40 elements. Regexes are anchored
 * - Overpass `~` is a substring match, so an unanchored `pub` would also match
 * `public_building` and similar non-food amenities.
 */
export function buildNearbyQuery(
  lat: number,
  lng: number,
  radiusM: number,
  kind: NearbyKind,
): string {
  const around = `(around:${radiusM},${lat},${lng})`;
  const blocks: string[] = [];
  if (kind === "food" || kind === "all") {
    blocks.push(`  node["amenity"~"^(restaurant|cafe|bar|fast_food|pub|food_court)$"]${around};`);
  }
  if (kind === "activity" || kind === "all") {
    blocks.push(`  node["tourism"~"^(museum|attraction|gallery|viewpoint)$"]${around};`);
    blocks.push(`  node["leisure"~"^(park|garden)$"]${around};`);
    blocks.push(`  node["historic"]${around};`);
  }
  return `[out:json][timeout:12];\n(\n${blocks.join("\n")}\n);\nout center tags 40;`;
}

/**
 * POST a nearby query to Overpass with a 15s timeout; on failure retry once
 * against the fallback endpoint. Throws when every endpoint fails - callers
 * (explore.nearby) convert that into a degraded, non-throwing response.
 * Responses are cached 7d in api_cache (`geo:ovp:{query hash}`).
 */
export function fetchNearby(
  lat: number,
  lng: number,
  radiusM: number,
  kind: NearbyKind,
): Promise<OverpassElement[]> {
  const query = buildNearbyQuery(lat, lng, radiusM, kind);
  return cachedJson(`geo:ovp:${cacheHash(query)}`, TTL_OVERPASS, () =>
    fetchNearbyUncached(query),
  );
}

async function fetchNearbyUncached(query: string): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt]!;
    try {
      const data = await fetchJson<OverpassResponse>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 15000,
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

/**
 * POST the query to Overpass with a 30s timeout; on failure retry once against
 * the fallback endpoint. `endpointOffset` lets bulk callers rotate endpoints.
 * Responses are cached 7d in api_cache (`geo:ovp:{query hash}`).
 */
export function fetchOverpass(bbox: Bbox, endpointOffset = 0): Promise<OverpassElement[]> {
  const query = buildOverpassQuery(bbox);
  return cachedJson(`geo:ovp:${cacheHash(query)}`, TTL_OVERPASS, () =>
    fetchOverpassUncached(query, endpointOffset),
  );
}

async function fetchOverpassUncached(
  query: string,
  endpointOffset = 0,
): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[(endpointOffset + attempt) % OVERPASS_ENDPOINTS.length]!;
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

/** Normalize one Overpass element into an explore_places row, or null if unusable. */
export function normalizeElement(
  el: OverpassElement,
  city: string,
  country: string,
): ExplorePlaceInsert | null {
  const tags = el.tags ?? {};
  const rawName = (tags.name ?? "").trim();
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
  const manMade = tags.man_made ?? "";
  const shop = tags.shop ?? ""; // r13-cafes
  // r15-places: parking lots / rest areas are never places to visit.
  if (amenity === "parking" || isParkingLikeName(name)) return null;
  // r15-places: thrill venues get their own categories (waterpark / themepark
  // / games) so they stop lumping into the generic activity bucket.
  const fun = funCategoryFor({ tourism, leisure });
  // r13-cafes: cuisine=coffee_shop marks a café even without amenity=cafe
  const coffeeShopCuisine = /(^|[;\s])coffee_shop/i.test(tags.cuisine ?? "");
  // Marketplaces are food ONLY when they signal prepared food (hawker centres,
  // food courts, night markets) - produce/vegetable/wholesale markets are shopping.
  const marketClass = amenity === "marketplace" ? classifyMarketplace(name, tags) : null;
  const category =
    marketClass ??
    (FOOD_OSM_VALUES.has(amenity) || BAKERY_SHOP_VALUES.has(shop) || coffeeShopCuisine // r13-cafes
      ? "food"
      : (fun?.category ?? "activity"));
  const isFood = category === "food";
  const isNightlife = ["bar", "pub", "nightclub", "biergarten"].includes(amenity);
  const isMusic =
    amenity === "music_venue" ||
    tourism === "theatre" ||
    amenity === "theatre" ||
    tourism === "arts_centre" ||
    amenity === "arts_centre";

  const placeTags: string[] = [];
  const pushTag = (t: string) => {
    if (!placeTags.includes(t)) placeTags.push(t);
  };
  if (tourism === "museum") pushTag("museum");
  if (tourism === "gallery") {
    pushTag("art");
    pushTag("museum");
  }
  if (tourism === "attraction") pushTag("landmark");
  if (tourism === "artwork") pushTag("artwork"); // statue-like: deprioritized in ranking
  if (tourism === "viewpoint") pushTag("views");
  // r15-places: kids' venues are family-only; thrill parks carry their own
  // tags (theme-park/water-park + rides, or the games vocabulary).
  if (tourism === "zoo" || tourism === "aquarium") pushTag("family");
  if (fun) {
    pushTag(fun.tag);
    pushTag(fun.category === "games" ? "games" : "rides");
  }
  if (historic) {
    pushTag("historic");
    if (historic === "monument" || historic === "memorial") pushTag("landmark");
    if (STATUE_OSM.historic.has(historic)) pushTag(historic); // memorial | statue
    if (["castle", "palace", "fort", "ruins", "archaeological_site"].includes(historic)) {
      pushTag("architecture");
    }
  }
  if (manMade === "statue") pushTag("statue");
  if (amenity === "marketplace") {
    pushTag("market");
    pushTag(marketClass === "food" ? "food" : "shopping");
  } else if (amenity === "cafe") {
    // r13-cafes: cafés carry the tags the UI's Cafés chip / coffee style match
    pushTag("cafe");
    pushTag("coffee");
    pushTag("food");
  } else if (FOOD_OSM_VALUES.has(amenity)) {
    pushTag("food");
  }
  // r13-cafes: bakery-class shops + cuisine=coffee_shop get café/bakery tags
  if (BAKERY_SHOP_VALUES.has(shop)) {
    pushTag("bakery");
    pushTag("food");
  }
  if (coffeeShopCuisine && amenity !== "cafe") {
    pushTag("cafe");
    pushTag("coffee");
  }
  if (amenity === "bar" || amenity === "pub") pushTag("nightlife");
  if (amenity === "nightclub") {
    pushTag("nightlife");
    pushTag("club");
  }
  if (amenity === "biergarten") pushTag("nightlife");
  if (amenity === "music_venue") pushTag("live-music");
  if (leisure === "park" || leisure === "garden" || leisure === "nature_reserve") pushTag("nature");
  // Dietary + cuisine signals (diet:vegetarian, diet:vegan, cuisine) - they
  // power veg-friendly filtering and food-quality suggestions.
  for (const t of dietCuisineTags(tags)) pushTag(t);

  const styles: string[] = [];
  const pushStyle = (s: string) => {
    if (!styles.includes(s)) styles.push(s);
  };
  if (historic || tourism === "museum") pushStyle("historical");
  if (isFood) pushStyle("food");
  if (amenity === "cafe" || coffeeShopCuisine) pushStyle("coffee"); // r13-cafes: extended style (style-map.ts)
  if (isNightlife || isMusic) pushStyle("nightlife");
  if (leisure === "park" || leisure === "garden" || leisure === "nature_reserve") pushStyle("relaxing");
  // r15-places: zoos are family, never adventure; thrill venues are.
  if (tourism === "viewpoint") pushStyle("adventure");
  if (fun) pushStyle("adventure");
  if (tourism === "zoo" || tourism === "aquarium") pushStyle("family");

  // r13-photos: real photo from OSM `image` / `wikimedia_commons` tags when
  // present (photoSource 'osm'); NULL keeps the stock-pool fallback.
  const osmImage = osmImageFromTags(tags);

  return {
    name: name.slice(0, 255),
    nameLocal: display.nameLocal ? display.nameLocal.slice(0, 255) : null, // r19-portal
    osmId: `${el.type}/${el.id}`,
    source: "osm",
    city,
    country,
    category,
    tags: placeTags.slice(0, 4), // diet:/cuisine tags ride along (cap 4)
    styles: styles.slice(0, 2),
    // OSM carries no rating or price-level data. These used to be written as
    // 4.3 / 2, which the UI then rendered as a gold-star rating and a "$$"
    // chip on every imported place, and which famous-eats thresholded on.
    // NULL is the honest value: "we don't know".
    rating: null,
    priceLevel: null,
    feeCents: null,
    feeCurrency: null,
    feeNote: null,
    description: null,
    hidden: false,
    image: osmImage, // r13-photos
    photoSource: osmImage ? "osm" : null, // r13-photos
    lat,
    lng,
  };
}

// ── Area (bbox) discovery - backs explore.discoverArea ─────────────────────

/** Largest bbox span (degrees) discoverArea accepts as-is; bigger boxes are
 * tightened around their center before querying Overpass. */
export const AREA_MAX_SPAN_DEG = 0.5;

/**
 * Overpass bbox query for "attractions anywhere on the planet" - tourism
 * (incl. artwork), all historic, food amenities and parks/gardens, nodes and
 * ways, capped at 120 elements. Tighter cap than the city bulk import (250)
 * because this runs interactively from the map's "Search this area" button.
 */
export function buildAreaQuery(b: Bbox): string {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  return `[out:json][timeout:25];
(
  node["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|theme_park|aquarium|artwork)$"](${bb});
  node["historic"](${bb});
  node["amenity"~"^(restaurant|cafe|bar|marketplace)$"](${bb});
  node["leisure"~"^(park|garden|water_park|amusement_arcade|escape_game|go_kart|paintball|bowling_alley)$"](${bb});
  way["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|theme_park|aquarium|artwork)$"](${bb});
  way["historic"](${bb});
  way["amenity"~"^(restaurant|cafe|bar|marketplace)$"](${bb});
  way["leisure"~"^(park|garden|water_park|amusement_arcade|escape_game|go_kart|paintball|bowling_alley)$"](${bb});
);
out center tags 120;`;
}

/**
 * POST an area query to Overpass with a 25s timeout; on failure retry once
 * against the fallback endpoint. Throws when every endpoint fails -
 * explore.discoverArea converts that into a 503-style error the client
 * surfaces as a friendly toast. Responses are cached 7d in api_cache
 * (`geo:ovp:{query hash}`).
 */
export function fetchArea(bbox: Bbox, endpointOffset = 0): Promise<OverpassElement[]> {
  const query = buildAreaQuery(bbox);
  return cachedJson(`geo:ovp:${cacheHash(query)}`, TTL_OVERPASS, () =>
    fetchAreaUncached(query, endpointOffset),
  );
}

async function fetchAreaUncached(query: string, endpointOffset = 0): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[(endpointOffset + attempt) % OVERPASS_ENDPOINTS.length]!;
    try {
      const data = await fetchJson<OverpassResponse>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 25000,
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

/**
 * Reverse-geocode one point with Photon (city + country only) - used to label
 * rows imported by discoverArea, where no city name is known up front.
 * Returns null on any failure; callers fall back to empty strings.
 * Successful lookups are cached 30d in api_cache (`geo:rev:{lat,lng @3dp}`).
 */
export function reverseGeocodePoint(
  lat: number,
  lng: number,
): Promise<{ city: string; country: string } | null> {
  return cachedJson(`geo:rev:${coord3(lat)},${coord3(lng)}`, TTL_PHOTON, () =>
    reverseGeocodePointUncached(lat, lng),
  );
}

async function reverseGeocodePointUncached(
  lat: number,
  lng: number,
): Promise<{ city: string; country: string } | null> {
  try {
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 4000,
      userAgent: USER_AGENT,
      service: "photon",
    });
    const p = data.features?.[0]?.properties;
    if (!p) return null;
    const city = p.city ?? p.town ?? p.village ?? p.district ?? p.state ?? "";
    const country = p.country ?? "";
    if (!city && !country) return null;
    return { city, country };
  } catch {
    return null;
  }
}

/**
 * Geocode `cityInput`, pull up to 250 named POIs from Overpass within a
 * ~0.15° bbox, dedupe against existing rows (osmId, or same name in the city),
 * insert the rest. Idempotent - safe to re-run.
 */
export async function importCityPlaces(cityInput: string, endpointOffset = 0): Promise<ImportCityResult> {
  const city = titleCase(cityInput);
  const geo = await geocodeCity(city);
  if (!geo) throw new Error(`Could not geocode city: ${cityInput}`);
  const elements = await fetchOverpass(bboxAround(geo.lat, geo.lng), endpointOffset);

  const db = getDb();
  const existing = await db
    .select({ name: schema.explorePlaces.name, osmId: schema.explorePlaces.osmId })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.city, city));
  const existingOsmIds = new Set(existing.map((r) => r.osmId).filter((v): v is string => v != null));
  const existingNames = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  const rows: ExplorePlaceInsert[] = [];
  const batchOsmIds = new Set<string>();
  for (const el of elements) {
    const row = normalizeElement(el, city, geo.country);
    if (!row) continue;
    const osmId = row.osmId as string;
    if (existingOsmIds.has(osmId) || batchOsmIds.has(osmId)) continue;
    const nameKey = row.name.trim().toLowerCase();
    if (existingNames.has(nameKey)) continue;
    batchOsmIds.add(osmId);
    existingNames.add(nameKey); // avoid duplicate names within the batch itself
    rows.push(row);
  }

  for (let i = 0; i < rows.length; i += 50) {
    await db.insert(schema.explorePlaces).values(rows.slice(i, i + 50));
  }
  const countRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.city, city));
  return { inserted: rows.length, total: Number(countRows[0]?.n ?? 0) };
}
