/**
 * Getaways / Around-you shared logic (r14-nearby).
 *
 * Pure, DB-free helpers shared by the getaways router, the cities seeder and
 * the unit tests:
 *
 *  1. CACHE KEYS + TTL - `getaways.near` and `getaways.aroundMe` cache their
 *     FULL responses in api_cache for 30 days ("once in a month refresh is
 *     fine"), so a repeat request never touches Overpass/OSRM/Photon:
 *       getaways:v2:near:<normcity | lat,lng@2dp>:<radiusKm>
 *       getaways:v2:aroundme:<lat,lng rounded to 0.25°>:<md5 sorted styles>
 *     (v1 → v2 with r15-places: classification/style-matcher changes make
 *     v1 payloads stale - produce markets in food, zoos in adventure.)
 *     `cacheThrough` wraps any compute with a read-through get/set pair and
 *     stamps `cachedAt` onto the payload (the cache layer itself is injected,
 *     which keeps this module testable without a database).
 *
 *  2. GETAWAY CLASSIFICATION - the keyword vocabulary and `classifyGetaway`
 *     (moved here from getaways-router so the seeder + tests share it).
 *
 *  3. PREFERENCE MATCHING - travel-style → category/tag matchers for
 *     `getaways.aroundMe` (nature/adventure → hikes+viewpoints+nature,
 *     historical/culture → heritage+museums, food & drink → cafes/restaurants,
 *     relaxing → lakes/parks/beaches, photography → viewpoints/landmarks).
 *
 *  4. RANKING / FILTERS - distance×rating blend, id/name+proximity dedupe and
 *     the <12 km city-sight exclusion band.
 */

import { createHash } from "node:crypto";
import { isGenericName } from "./place-quality";

// ─── distances ───────────────────────────────────────────────────────────────

/** Great-circle distance in km (haversine). Local copy - this module stays DB-free. */
export function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Places closer than this to the anchor are city sights, not getaways. */
export const CITY_SIGHT_KM = 12;

/** True when a distance sits inside the getaway band [12 km, radiusKm]. */
export function withinGetawayBand(distKm: number, radiusKm: number): boolean {
  return distKm >= CITY_SIGHT_KM && distKm <= radiusKm;
}

// ─── 30-day result cache ─────────────────────────────────────────────────────

/** "Once in a month refresh is fine." */
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const NEAR_CACHE_TTL_MS = THIRTY_DAYS_MS;
export const AROUND_ME_CACHE_TTL_MS = THIRTY_DAYS_MS;
/** Seeder checkpoint TTL - generous so a wiped sandbox can still resume. */
export const SEED_CHECKPOINT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const SEED_PROGRESS_KEY = "getaways-seed:progress";

const normKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Cache key for `getaways.near`. City anchors key on the normalized city
 * name; raw-coordinate anchors round to 2 dp (~1.1 km) so tiny GPS jitter
 * still hits the same entry. radiusKm is part of the key.
 */
export function nearCacheKeyFor(input: {
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm: number;
}): string {
  if (input.city && input.city.trim()) {
    // v2: payloads carry famousEatery (r15-eats) - skip pre-flag entries.
    return `getaways:v2:near:${normKey(input.city)}:${input.radiusKm}`;
  }
  const lat = (input.lat ?? 0).toFixed(2);
  const lng = (input.lng ?? 0).toFixed(2);
  return `getaways:v2:near:${lat},${lng}:${input.radiusKm}`;
}

/** Round a coordinate to the nearest 0.25° (~28 km) cache cell. */
export function roundQuarter(deg: number): number {
  return Math.round(deg * 4) / 4;
}

/** md5 of the sorted, normalized style list - order-insensitive. */
export function stylesHash(styles: string[]): string {
  const sorted = [...new Set(styles.map(normKey))].filter(Boolean).sort();
  return createHash("md5").update(sorted.join(",")).digest("hex").slice(0, 16);
}

/** Cache key for `getaways.aroundMe`. */
export function aroundMeCacheKeyFor(input: { lat: number; lng: number; styles?: string[] }): string {
  // v2: payloads carry famousEatery (r15-eats) - skip pre-flag entries.
  return `getaways:v2:aroundme:${roundQuarter(input.lat)},${roundQuarter(input.lng)}:${stylesHash(input.styles ?? [])}`;
}

/** Minimal cache contract - api/lib/cache.ts's cacheGet/cacheSet satisfy it. */
export interface CacheLike {
  get<T>(k: string): Promise<T | null>;
  set(k: string, v: unknown, ttlMs: number): Promise<void>;
}

/**
 * Read-through cache for full procedure responses. A hit returns the stored
 * payload verbatim (it already carries `cachedAt` from the original miss);
 * a miss computes, stamps `cachedAt`, stores with the TTL, and returns.
 * Compute errors propagate WITHOUT caching, so failures retry next request.
 */
export async function cacheThrough<T extends object>(
  cache: CacheLike,
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T & { cachedAt: string }> {
  const hit = await cache.get<T & { cachedAt: string }>(key);
  if (hit) return hit;
  const payload = await compute();
  const out = { ...payload, cachedAt: new Date().toISOString() };
  await cache.set(key, out, ttlMs);
  return out;
}

// ─── getaway classification (shared by router, seeder, tests) ───────────────

/** Candidate prefilter - name or any tag matching one of these is a getaway. */
export const GETAWAY_KEYWORD_RE =
  /peak|\bhills?\b|trek|hike|trail|viewpoint|waterfall|\bfalls\b|reserve|\bfort\b|ruins|\blakes?\b|\bdam\b|sanctuary|caves?|heritage|gorge|hot[\s-]?spring/i;
const WATER_RE = /waterfall|\bfalls\b/i;
const HIKE_RE = /peak|trek|hike|trail|viewpoint|\bhills?\b|climb/i;
const HERITAGE_RE = /\bfort\b|ruins|heritage/i;
const NATURE_RE =
  /waterfall|\bfalls\b|reserve|\blakes?\b|\bdam\b|sanctuary|gorge|caves?|hot[\s-]?spring/i;

export type GetawayGroupKey = "hikes" | "nature" | "heritage";

const haystack = (name: string, tags: string[] | null) =>
  `${name} ${(tags ?? []).join(" ")}`;

/** Group + chip-kind for one candidate; null when it isn't a getaway. */
export function classifyGetaway(
  name: string,
  tags: string[] | null,
): { group: GetawayGroupKey; kind: string } | null {
  const hay = haystack(name, tags);
  if (!GETAWAY_KEYWORD_RE.test(hay)) return null;
  // Precedence: waterfalls are nature even when they carry a viewpoint tag;
  // a fort you trek to is a hike; a plain fort is heritage; everything else
  // watery/green is nature.
  if (WATER_RE.test(hay)) return { group: "nature", kind: "waterfall" };
  if (HIKE_RE.test(hay)) {
    const kind = /peak/i.test(hay)
      ? "peak"
      : /viewpoint/i.test(hay)
        ? "viewpoint"
        : /trek/i.test(hay)
          ? "trek"
          : /trail/i.test(hay)
            ? "trail"
            : /climb/i.test(hay)
              ? "climb"
              : /\bhills?\b/i.test(hay)
                ? "hill"
                : "hike";
    return { group: "hikes", kind };
  }
  if (HERITAGE_RE.test(hay)) {
    const kind = /ruins/i.test(hay) ? "ruins" : /\bfort\b/i.test(hay) ? "fort" : "heritage";
    return { group: "heritage", kind };
  }
  if (NATURE_RE.test(hay)) {
    const kind = /sanctuary/i.test(hay)
      ? "sanctuary"
      : /reserve/i.test(hay)
        ? "reserve"
        : /caves?/i.test(hay)
          ? "caves"
          : /gorge/i.test(hay)
            ? "gorge"
            : /hot[\s-]?spring/i.test(hay)
              ? "hot spring"
              : /\bdam\b/i.test(hay)
                ? "dam"
                : "lake";
    return { group: "nature", kind };
  }
  return null;
}

// ─── preference → category/tag matching ──────────────────────────────────────

export interface StyleMatcher {
  /** explore_places.category values this style accepts */
  categories: string[];
  /** name/tag substring vocabulary for this style */
  tagRe: RegExp;
}

const OUTDOORS: StyleMatcher = {
  // r15-places: adventure also matches thrill venues (theme/water parks,
  // games) - never zoos/playgrounds (those are family-only now).
  categories: ["adventure", "natural", "themepark", "waterpark", "games"],
  tagRe:
    /peak|hike|trek|trail|viewpoint|climb|\bhills?\b|waterfall|\bfalls\b|reserve|sanctuary|nature|gorge|caves?|hot[\s-]?spring|theme[- ]?park|water[- ]?park|amusement|rafting|zipline|go[- ]?kart|paintball|surf/i,
};
const HERITAGE: StyleMatcher = {
  categories: ["historic"],
  tagRe:
    /historic|heritage|museum|gallery|\bart\b|\bfort\b|ruins|palace|castle|temple|church|mosque|monastery|monument|architecture|landmark/i,
};
const FOOD: StyleMatcher = {
  categories: ["food"],
  // r15-places: bare "market" no longer implies food - produce/wholesale
  // markets are shopping; street-food/hawker signals stay.
  tagRe: /food|restaurant|cafe|coffee|bakery|street[- ]?food|hawker|bar|pub|bistro|nightlife/i,
};
const RELAXING: StyleMatcher = {
  // lakes/parks/beaches - tag-driven; "activity" as a category is too broad
  categories: ["natural"],
  tagRe: /\blakes?\b|park|garden|beach|nature|promenade|spa|reservoir|\bdam\b/i,
};
const PHOTOGRAPHY: StyleMatcher = {
  // viewpoints (categorized "adventure" by the getaway importer) + landmarks
  categories: ["adventure"],
  tagRe: /viewpoint|views|photography|sunset|sunrise|skyline|observatory|landmark/i,
};
const EVERYTHING: StyleMatcher = { categories: [], tagRe: /./ };

/** Style vocabulary - canonical PREFERENCE_STYLES plus quiz-chip synonyms. */
const STYLE_MATCHERS: Record<string, StyleMatcher> = {
  adventure: OUTDOORS,
  nature: OUTDOORS,
  outdoors: OUTDOORS,
  historical: HERITAGE,
  culture: HERITAGE,
  heritage: HERITAGE,
  food: FOOD,
  "food & drink": FOOD,
  drink: FOOD,
  coffee: FOOD,
  nightlife: FOOD,
  relaxing: RELAXING,
  relaxation: RELAXING,
  photography: PHOTOGRAPHY,
  photos: PHOTOGRAPHY,
  budget: EVERYTHING, // budget filters on price, not kind - matches everything
  shopping: EVERYTHING,
};

/** The matcher set for a list of requested styles (unknown styles ignored). */
export function styleMatchersFor(styles: string[]): StyleMatcher[] {
  const out: StyleMatcher[] = [];
  for (const s of styles) {
    const m = STYLE_MATCHERS[normKey(s)];
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * True when a place matches ANY of the requested styles (union semantics).
 * An empty/unknown-only style list matches everything - no preference stated.
 */
export function matchesStyle(
  place: { name: string; category: string; tags?: string[] | null },
  styles: string[],
): boolean {
  const matchers = styleMatchersFor(styles);
  if (matchers.length === 0) return true;
  const hay = haystack(place.name, place.tags ?? null);
  const cat = place.category.toLowerCase();
  return matchers.some((m) => m.categories.includes(cat) || m.tagRe.test(hay));
}

// ─── ranking + dedupe ────────────────────────────────────────────────────────

/**
 * Around-you score: 70% rating quality (3.0→0.05 … 5.0→1.0, unrated → 4.2),
 * 30% proximity (1 at the anchor, decaying ~1/(1+km/40) → ~0.2 at 150 km).
 * Higher is better; rounded to 1 dp for stable ordering.
 */
export function aroundMeScore(input: { rating: number | null; distKm: number }): number {
  const rating = input.rating ?? 4.2;
  const ratingW = Math.min(1, Math.max(0.05, (rating - 3) / 2));
  const distW = 1 / (1 + Math.max(0, input.distKm) / 40);
  return Math.round((ratingW * 70 + distW * 30) * 10) / 10;
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
/** Same-name rows closer than this are considered the same place. */
export const DEDUPE_RADIUS_KM = 5;

/**
 * Dedupe a candidate list: first by row id, then by normalized name within
 * DEDUPE_RADIUS_KM (catches the same spot imported once as an OSM node and
 * once as a curated row). Generic OSM placeholder names are dropped entirely.
 */
export function dedupePlaces<T extends { id: number; name: string; lat: number | null; lng: number | null }>(
  rows: T[],
): T[] {
  const seenIds = new Set<number>();
  const keptNames: { key: string; lat: number; lng: number }[] = [];
  const out: T[] = [];
  for (const r of rows) {
    if (seenIds.has(r.id)) continue;
    if (isGenericName(r.name)) continue;
    if (r.lat != null && r.lng != null) {
      const key = normName(r.name);
      const dupe = keptNames.some(
        (n) => n.key === key && kmBetween(n.lat, n.lng, r.lat as number, r.lng as number) <= DEDUPE_RADIUS_KM,
      );
      if (dupe) continue;
      keptNames.push({ key, lat: r.lat, lng: r.lng });
    }
    seenIds.add(r.id);
    out.push(r);
  }
  return out;
}
