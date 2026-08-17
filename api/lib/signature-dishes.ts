/**
 * Signature-dish place matching (r16-culinary).
 *
 * Pure helpers shared by db/import-signature-dishes.ts and its tests: match a
 * dish-place entry from db/data/signature-dishes-*.json against the
 * explore_places corpus by normalized-name similarity + haversine proximity
 * (<1 km, same city). Unmatched entries become curated corpus inserts.
 */

/** Normalize a place/dish name for comparison: accents + punctuation out. */
export function normalizePlaceName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Great-circle distance in km (haversine). */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Generic tokens that must not carry a name match on their own. */
const GENERIC_TOKENS = new Set([
  "the", "a", "an", "of", "and", "at", "in", "on",
  "cafe", "café", "coffee", "restaurant", "hotel", "bar", "kitchen",
  "dosa", "idli", "tiffin", "bhavan", "house", "corner", "food",
]);

/** Distinctive (match-carrying) tokens of a normalized name. */
function distinctiveTokens(norm: string): string[] {
  return norm.split(" ").filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
}

/**
 * True when two normalized place names refer to the same establishment:
 * exact/containment match, or they share ≥1 distinctive token.
 * ("Mavalli Tiffin Room (MTR)" ↔ "Mavalli Tiffin Rooms"; "CTR (Central
 * Tiffin Room)" ↔ "Shree Sagar CTR".) Proximity is checked separately.
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizePlaceName(a);
  const nb = normalizePlaceName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = distinctiveTokens(na);
  const tb = new Set(distinctiveTokens(nb));
  for (const t of ta) {
    if (tb.has(t)) return true;
    // inflection/stem match ("brahmin" ↔ "brahmins") for longer tokens
    if (t.length >= 4) {
      for (const u of tb) if (u.length >= 4 && (u.startsWith(t) || t.startsWith(u))) return true;
    }
  }
  return false;
}

export interface DishPlaceInput {
  name: string;
  lat?: number | null;
  lng?: number | null;
}

export interface CorpusCandidate {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

export const MATCH_RADIUS_KM = 1;

/**
 * Best corpus match for a dish place: name-similar AND within 1 km; nearest
 * wins. Candidates must already be filtered to the same (city, country).
 * Entries without coordinates can still match on exact/containment name only.
 */
export function matchDishPlace<T extends CorpusCandidate>(
  candidates: T[],
  target: DishPlaceInput,
  radiusKm = MATCH_RADIUS_KM,
): { place: T; distanceKm: number | null } | null {
  const tHasGeo =
    target.lat != null && target.lng != null &&
    Number.isFinite(target.lat) && Number.isFinite(target.lng);
  let best: { place: T; distanceKm: number | null } | null = null;
  for (const c of candidates) {
    if (!namesMatch(c.name, target.name)) continue;
    const cHasGeo =
      c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng);
    if (tHasGeo && cHasGeo) {
      const d = haversineKm(
        { lat: target.lat as number, lng: target.lng as number },
        { lat: c.lat as number, lng: c.lng as number },
      );
      if (d > radiusKm) continue;
      if (!best || (best.distanceKm ?? Infinity) > d) best = { place: c, distanceKm: d };
    } else {
      // geo missing on one side: accept only strong (containment) name match
      const na = normalizePlaceName(c.name);
      const nb = normalizePlaceName(target.name);
      if (!(na === nb || na.includes(nb) || nb.includes(na))) continue;
      if (!best) best = { place: c, distanceKm: null };
    }
  }
  return best;
}

/** Café-ish heuristic for corpus tags of imported signature-dish places. */
export function isCafeIsh(name: string, dish: string): boolean {
  const s = normalizePlaceName(`${name} ${dish}`);
  return /coffee|cafe|espresso|brew|tea|bakery|chai|roaster/.test(s);
}
