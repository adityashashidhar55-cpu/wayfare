/**
 * quality.ts (r28) - the single definition of "is this place worth showing".
 *
 * The corpus is 526,142 rows of which, measured: 4,304 have a photo, 329 have
 * a description over 200 characters, and 45 have both. Ranking and filtering
 * therefore cannot treat rows as interchangeable, and the old signal that was
 * meant to do this job - `rating` - was a fabricated 4.3 on 99.9% of rows.
 *
 * qualityScore is computed once at import (db/import-corpus.ts) and stored, so
 * the feed never recomputes it per request. This module holds the definition
 * plus the tier thresholds the UI and API filter on, so all of them agree.
 */

/** Score bands. Deliberately few - these map to product decisions, not a curve. */
export const QUALITY = {
  /** Has a photo AND a real write-up. Front-page material. */
  SHOWCASE: 60,
  /** Enough substance to headline a city feed. */
  GOOD: 40,
  /** Some content: a short description, a verdict, or a fee. Fine in a list. */
  DECENT: 20,
  /** Name and coordinates only. Valid on a map, weak in a feed. */
  THIN: 1,
} as const;

export type QualityTier = "showcase" | "good" | "decent" | "thin" | "bare";

export function tierOf(score: number | null | undefined): QualityTier {
  const s = score ?? 0;
  if (s >= QUALITY.SHOWCASE) return "showcase";
  if (s >= QUALITY.GOOD) return "good";
  if (s >= QUALITY.DECENT) return "decent";
  if (s >= QUALITY.THIN) return "thin";
  return "bare";
}

/**
 * Compute a 0-100 score from a place row. Pure, so the importer and any
 * backfill agree exactly.
 *
 * Weights reflect what a traveller actually reacts to: a photo and real prose
 * dominate, editorial signals add, and everything else is a small nudge. A
 * rating deliberately contributes NOTHING - we have almost no genuine ones,
 * and letting it in is how the fabricated 4.3 became a ranking signal before.
 */
export function computeQuality(p: {
  description?: string | null;
  descriptionSource?: string | null;
  image?: string | null;
  photoAttribution?: string | null;
  verdict?: string | null;
  famousEatery?: boolean | number | null;
  feeCents?: number | null;
  mealCents?: number | null;
  nameLocal?: string | null;
  hidden?: boolean | number | null;
}): number {
  let s = 0;
  const d = p.description ? p.description.length : 0;
  if (d > 400) s += 40;
  else if (d > 200) s += 30;
  else if (d > 80) s += 12;
  else if (d > 0) s += 4;
  if (p.descriptionSource === "curated") s += 20;
  if (p.image) s += 25;
  if (p.photoAttribution) s += 3;
  if (p.verdict === "must-see") s += 12;
  else if (p.verdict === "worth-it") s += 6;
  if (p.famousEatery) s += 8;
  if (p.feeCents != null || p.mealCents != null) s += 4;
  if (p.nameLocal) s += 2;
  if (p.hidden) s += 3;
  return Math.min(100, s);
}

/** Infrastructure, not a destination. */
export const JUNK_NAME_RE =
  /^(parking|parkplatz|toilets?|wc|bench|atm|geldautomat|bus stop|bushaltestelle|shelter|drinking water|waste basket|recycling|fuel|petrol|gas station|post box|telephone|bicycle parking|car wash|charging station|vending machine|taxi|pharmacy|apotheke|kiosk|newsagent|hairdresser|barber|car repair|tyres?|laundry|dry cleaning|copyshop|bank|bureau de change|clothes|shoes|optician|mobile phone|tobacco|betting|pawnbroker)$/i;

/**
 * Chain outlets: real places, never the reason for a trip.
 *
 * Two deliberate choices here. The name must be the chain alone or the chain
 * followed by a branch qualifier ("Starbucks Koramangala"), never a mid-string
 * match - otherwise "The Subway Museum" gets binned. And ordinary English
 * words that happen to be chains (Target, Action, Spar, Costa, Next) are
 * excluded entirely: catching one Target outlet is not worth mislabelling
 * "Target Practice Brewery" or "Costa Verde Beach".
 */
const CHAIN_NAMES = [
  "mcdonald'?s", "kfc", "burger king", "subway", "starbucks", "domino'?s", "pizza hut",
  "dunkin'?( donuts)?", "greggs", "tim hortons", "hema", "tk ?maxx", "lidl", "aldi",
  "tesco", "carrefour", "7-eleven", "circle k", "walmart", "h&m", "zara", "c&a",
  "primark", "decathlon", "ikea", "jysk", "kruidvat", "etos", "blokker", "pret a manger",
  "cafe coffee day", "ccd", "barista", "haldiram'?s", "bikanervala",
];
export const CHAIN_NAME_RE = new RegExp(
  `^(${CHAIN_NAMES.join("|")})(\\s+[\\w'’&.,-]+)*$`,
  "i",
);

export function isJunkName(name: string): boolean {
  return JUNK_NAME_RE.test((name || "").trim());
}
export function isChainName(name: string): boolean {
  return CHAIN_NAME_RE.test((name || "").trim());
}
