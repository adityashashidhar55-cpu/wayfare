/**
 * transport-estimate.ts (r24-core, feature H) - pure, dependency-free
 * "Rome2Rio-style" approx per-leg cost estimates between consecutive stops.
 *
 * Everything is APPROXIMATE by design: no schedules, no live fares, just
 * per-km heuristics scaled by a coarse country cost tier. All outputs are
 * USD cents ranges; callers convert/display with the trip currency and must
 * label the numbers "approx".
 */

export type LegMode = "walk" | "transit" | "train" | "flight" | "car";
export type CostTier = "high" | "mid" | "low";

export interface LegEstimate {
  mode: LegMode;
  km: number;
  /** approx fare range in USD cents (per person, except car = per vehicle/day share) */
  centsLow: number;
  centsHigh: number;
  /** false when the mode makes no sense for this distance (e.g. flight for 3 km) */
  available: boolean;
  note: string;
}

/* ── Country cost tier (PPP-ish, coarse). Default: "mid". ── */
const TIER_HIGH = new Set([
  "switzerland", "norway", "iceland", "denmark", "sweden", "finland",
  "united kingdom", "ireland", "france", "netherlands", "belgium",
  "luxembourg", "germany", "austria", "italy", "japan", "south korea",
  "australia", "new zealand", "united states", "canada", "singapore",
  "united arab emirates", "qatar", "israel", "hong kong",
]);
const TIER_LOW = new Set([
  "india", "indonesia", "vietnam", "thailand", "philippines", "cambodia",
  "laos", "nepal", "sri lanka", "bangladesh", "pakistan", "myanmar",
  "egypt", "morocco", "tunisia", "turkey", "mexico", "colombia", "peru",
  "bolivia", "brazil", "argentina", "ukraine", "albania", "georgia",
  "uzbekistan", "kenya", "tanzania", "nigeria", "ghana",
]);

export function countryTier(country: string | null | undefined): CostTier {
  const c = (country ?? "").trim().toLowerCase();
  if (!c) return "mid";
  if (TIER_HIGH.has(c)) return "high";
  if (TIER_LOW.has(c)) return "low";
  return "mid";
}

/* Detection-only set: extra mid-tier countries so free-text destination
   segments ("Tokyo, Japan, Paris, France") can be matched to a country. */
const TIER_MID_KNOWN = new Set([
  "spain", "portugal", "greece", "croatia", "czechia", "czech republic",
  "poland", "hungary", "malta", "cyprus", "estonia", "latvia", "lithuania",
  "chile", "uruguay", "south africa", "malaysia", "china", "taiwan",
]);

const KNOWN_COUNTRIES = new Set([...TIER_HIGH, ...TIER_LOW, ...TIER_MID_KNOWN]);

/**
 * Returns the normalized country when a free-text segment is a country we
 * know, else null. Used to derive a cost-tier hint from trip.destination.
 */
export function knownCountry(segment: string | null | undefined): string | null {
  const c = (segment ?? "").trim().toLowerCase();
  return c && KNOWN_COUNTRIES.has(c) ? c : null;
}

/** First recognizable country in a "City, Country, City, Country" string. */
export function countryFromDestination(destination: string | null | undefined): string | null {
  for (const part of (destination ?? "").split(",")) {
    const hit = knownCountry(part);
    if (hit) return hit;
  }
  return null;
}

/** Tier multiplier applied to the mid-tier per-km rates. */
const TIER_MULT: Record<CostTier, number> = { high: 1.3, mid: 1, low: 0.55 };

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* Distance gates */
const WALK_MAX_KM = 1.5; // walk: free, only sensible below this
const TRANSIT_MAX_KM = 60; // local transit: urban legs only
const TRAIN_MIN_KM = 8; // below this a train makes little sense
const FLIGHT_MIN_KM = 400; // flights only beyond this
const CAR_MIN_KM = 5; // car rental only pays off beyond a short hop

const r = (v: number) => Math.max(0, Math.round(v));

/**
 * Per-leg fare estimates for every mode, in USD cents.
 * - walk:   free, only when km < 1.5
 * - transit: ~$0.30-0.60/km urban heuristic, tier-scaled, min ~$1.50 base
 * - train:  ~$0.05-0.15/km intercity, tier-scaled
 * - flight: only when km > 400: $40 base + $0.08-0.18/km (not tier-scaled,
 *           airfare tracks distance more than local prices)
 * - car:    rental $50-90/day (tier-scaled) + fuel $0.10/km; a leg shorter
 *           than a day still counts one rental day share
 */
export function estimateLeg(
  km: number,
  country?: string | null,
): LegEstimate[] {
  const tier = countryTier(country);
  const m = TIER_MULT[tier];
  const d = Math.max(0, km);

  return [
    {
      mode: "walk",
      km: d,
      centsLow: 0,
      centsHigh: 0,
      available: d < WALK_MAX_KM,
      note: d < WALK_MAX_KM ? "Free, on foot" : "Too far to walk",
    },
    {
      mode: "transit",
      km: d,
      centsLow: r((150 + d * 30) * m),
      centsHigh: r((250 + d * 60) * m),
      available: d >= WALK_MAX_KM && d <= TRANSIT_MAX_KM,
      note: "Local bus/metro, approx per person",
    },
    {
      mode: "train",
      km: d,
      centsLow: r(d * 5 * m + 300),
      centsHigh: r(d * 15 * m + 500),
      available: d >= TRAIN_MIN_KM && d <= 1500,
      note: "Intercity rail, approx per person",
    },
    {
      mode: "flight",
      km: d,
      centsLow: r(4000 + d * 8),
      centsHigh: r(4000 + d * 18),
      available: d > FLIGHT_MIN_KM,
      note: "Economy one-way, approx per person",
    },
    {
      mode: "car",
      km: d,
      centsLow: r(5000 * m + d * 10),
      centsHigh: r(9000 * m + d * 10),
      available: d >= CAR_MIN_KM && d <= 1200,
      note: "Rental day share + fuel, approx per car",
    },
  ];
}

/** The mode we would preselect for a leg of this distance. */
export function suggestMode(km: number): LegMode {
  if (km < WALK_MAX_KM) return "walk";
  if (km <= TRANSIT_MAX_KM) return "transit";
  if (km <= FLIGHT_MIN_KM) return "train";
  return "flight";
}

/** Midpoint of the approx range, for totals (USD cents). */
export function estimateMidCents(e: LegEstimate): number {
  return Math.round((e.centsLow + e.centsHigh) / 2);
}
