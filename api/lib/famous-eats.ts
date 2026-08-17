/**
 * famous-eats.ts - deterministic "famous eatery" rule (r15-eats).
 *
 * User ask: "every place that you go, look for the best eateries (the most
 * famous ones) - put a star telling this is what people can pick from."
 *
 * Per (city, country), a food-category place is a FAMOUS EATERY when either:
 *   1. verdict = 'must-see'  (editorial override - always famous), or
 *   2. it ranks in the top TOP_PCT (8%) of the city's food places by rating,
 *      requiring rating >= MIN_RATING (4.3), capped at MAX_PER_CITY (15).
 *
 * Ties break by id ascending so the pick is fully deterministic. The
 * 'must-see' override is NOT subject to the cap (there are only a handful
 * corpus-wide); the rating-based quota is.
 *
 * The r11-journal place_comments table is currently empty, so the
 * "≥3 user comments" fame signal is skipped - pickFamousEateries accepts an
 * optional commentCounts map so the signal can be switched on later without
 * changing the call sites.
 *
 * Pure functions, no I/O - shared by db/seed-famous-eats.ts (backfill) and
 * unit-tested in api/lib/famous-eats.test.ts.
 */

export const FAME_TOP_PCT = 0.08;
export const FAME_MIN_RATING = 4.3;
export const FAME_MAX_PER_CITY = 15;
export const FAME_MIN_COMMENTS = 3;

/** Corpus categories that count as eateries (surveyed: food is the only one). */
export const EATERY_CATEGORIES = new Set(["food"]);

export interface FameCandidate {
  id: number;
  rating?: number | null;
  verdict?: string | null;
  /** "osm" | "wikipedia" | "curated" - NULL means the stock-pool fallback. */
  photoSource?: string | null;
  /** "curated" | "dbpedia" | "composed" | "user" - NULL means none. */
  descriptionSource?: string | null;
}

export interface FameOptions {
  topPct?: number;
  minRating?: number;
  maxPerCity?: number;
  minComments?: number;
  /** placeId → user-comment count (skip signal when omitted/empty) */
  commentCounts?: ReadonlyMap<number, number>;
}

/** Rating-based quota for a city with `total` food places. */
export function fameQuota(
  total: number,
  topPct: number = FAME_TOP_PCT,
  maxPerCity: number = FAME_MAX_PER_CITY,
): number {
  if (total <= 0) return 0;
  return Math.min(maxPerCity, Math.max(1, Math.ceil(total * topPct)));
}

/**
 * Returns the ids of the famous eateries among `candidates` - the food
 * places of ONE (city, country). Deterministic.
 */
export function pickFamousEateries(
  candidates: FameCandidate[],
  opts: FameOptions = {},
): Set<number> {
  const {
    topPct = FAME_TOP_PCT,
    minRating = FAME_MIN_RATING,
    maxPerCity = FAME_MAX_PER_CITY,
    minComments = FAME_MIN_COMMENTS,
    commentCounts,
  } = opts;

  const famous = new Set<number>();

  // 1. editorial override: must-see verdicts are always famous.
  for (const p of candidates) {
    if (p.verdict === "must-see") famous.add(p.id);
  }

  // 2. top-N by rating (rating >= minRating), capped.
  //
  // Only rows with a GENUINE rating are eligible. This used to be
  // `(p.rating ?? 0) >= minRating` with minRating === 4.3 -- which was exactly
  // the constant the OSM importer wrote onto every place. So in practice the
  // filter admitted the whole corpus and the sort collapsed to the `a.id - b.id`
  // tie-break: "top 8% by rating" was really "first 8% by insertion order".
  // verdict.ts:12 already documented that 4.3 is not a signal; this honours it.
  const quota = fameQuota(candidates.length, topPct, maxPerCity);
  const byRating = candidates
    .filter((p) => typeof p.rating === "number" && p.rating >= minRating)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.id - b.id);
  for (const p of byRating.slice(0, quota)) famous.add(p.id);

  // 2b. quality fallback for cities with no genuinely-rated eateries (the
  // common case after the 4.3 purge). A real photo of the actual place plus a
  // researched description is the strongest non-rating signal in the corpus,
  // and unlike the old rating threshold it cannot be satisfied by an untouched
  // import. Curated verdicts still win via step 1.
  if (!byRating.length) {
    const byQuality = candidates
      .filter((p) => p.photoSource != null && (p.descriptionSource === "curated" || p.descriptionSource === "dbpedia"))
      .sort((a, b) => a.id - b.id);
    for (const p of byQuality.slice(0, quota)) famous.add(p.id);
  }

  // 3. community signal: ≥ minComments user comments (currently unused -
  //    place_comments is empty, but wire-ready).
  if (commentCounts) {
    for (const p of candidates) {
      if ((commentCounts.get(p.id) ?? 0) >= minComments) famous.add(p.id);
    }
  }

  return famous;
}

// ─── famousEats fallback: nearest big corpus city ───────────────────────────

/** A (city, country) with food-place stats, candidate for the fallback pick. */
export interface FamousFallbackCity {
  city: string;
  country: string;
  lat: number;
  lng: number;
  /** food places in the corpus for this city */
  food: number;
  /** famous eateries in this city */
  famous: number;
}

/** "Big" corpus city threshold for the famousEats fallback. */
export const FAMOUS_FALLBACK_BIG_CITY_FOOD = 50;

/**
 * Pick the fallback city for explore.famousEats when the requested city has
 * no famous eateries of its own: the NEAREST big corpus city (≥ 50 food
 * places, else the biggest pool available) that has famous eateries. When
 * the requested city isn't in the corpus (origin null), distance is unknown
 * and the biggest food city wins instead. Returns null when no city has
 * famous eateries at all. Deterministic (ties break by name).
 */
export function pickFamousEatsFallback(
  candidates: FamousFallbackCity[],
  requestedCity: string,
  origin: { lat: number; lng: number } | null,
): FamousFallbackCity | null {
  let pool = candidates.filter((c) => c.famous > 0 && c.city !== requestedCity);
  const big = pool.filter((c) => c.food >= FAMOUS_FALLBACK_BIG_CITY_FOOD);
  if (big.length) pool = big;
  if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
    const { lat, lng } = origin;
    pool.sort(
      (a, b) =>
        kmBetween(lat, lng, a.lat, a.lng) - kmBetween(lat, lng, b.lat, b.lng) ||
        a.city.localeCompare(b.city),
    );
  } else {
    pool.sort((a, b) => b.food - a.food || a.city.localeCompare(b.city));
  }
  return pool[0] ?? null;
}

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
