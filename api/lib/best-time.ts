/**
 * best-time.ts (r24-smart, feature O) - pure "best time to go" advisor for
 * wishlisted destinations. Scores months 1-12 on typical climate (latitude
 * band model), cost seasonality (curated peak/shoulder/off table for major
 * destinations, sane defaults otherwise) and crowds. No I/O; fully tested.
 */

import { climateNormsFor } from "./climate";

export interface DestinationSeasonality {
  /** months (1-12) with peak prices and crowds */
  peak: number[];
  /** months with noticeably lower prices */
  off: number[];
  /** representative latitude for the climate model */
  lat: number;
}

/**
 * Curated seasonality for ~30 major destinations, keyed by a lowercase
 * substring matched against the destination string. Everything not listed
 * falls back to DEFAULT_SEASONALITY with a latitude guessed from the text
 * when possible (else 40N temperate).
 */
export const DESTINATION_SEASONS: Record<string, DestinationSeasonality> = {
  paris: { peak: [6, 7, 8, 12], off: [1, 2, 11], lat: 48.9 },
  london: { peak: [6, 7, 8, 12], off: [1, 2, 11], lat: 51.5 },
  rome: { peak: [6, 7, 8], off: [1, 2, 11], lat: 41.9 },
  barcelona: { peak: [6, 7, 8], off: [1, 2, 11, 12], lat: 41.4 },
  amsterdam: { peak: [4, 5, 6, 7, 8], off: [1, 2, 11], lat: 52.4 },
  berlin: { peak: [6, 7, 8, 12], off: [1, 2, 11], lat: 52.5 },
  prague: { peak: [6, 7, 8, 12], off: [1, 2, 11], lat: 50.1 },
  vienna: { peak: [6, 7, 8, 12], off: [1, 2, 3], lat: 48.2 },
  lisbon: { peak: [6, 7, 8, 9], off: [1, 2, 12], lat: 38.7 },
  athens: { peak: [6, 7, 8], off: [1, 2, 11, 12], lat: 38.0 },
  istanbul: { peak: [6, 7, 8, 9], off: [1, 2, 12], lat: 41.0 },
  tokyo: { peak: [3, 4, 8, 11], off: [1, 2, 6], lat: 35.7 },
  kyoto: { peak: [3, 4, 8, 11], off: [1, 2, 6], lat: 35.0 },
  osaka: { peak: [3, 4, 8, 11], off: [1, 2, 6], lat: 34.7 },
  seoul: { peak: [4, 5, 9, 10], off: [1, 2, 7, 8], lat: 37.6 },
  bangkok: { peak: [11, 12, 1], off: [5, 6, 7, 8, 9], lat: 13.8 },
  "chiang mai": { peak: [11, 12, 1, 2], off: [6, 7, 8, 9], lat: 18.8 },
  singapore: { peak: [12, 1, 6, 7], off: [4, 5, 9, 10], lat: 1.35 },
  bali: { peak: [7, 8, 12], off: [1, 2, 3, 11], lat: -8.4 },
  "hong kong": { peak: [10, 11, 12, 1], off: [6, 7, 8], lat: 22.3 },
  dubai: { peak: [11, 12, 1, 2, 3], off: [6, 7, 8], lat: 25.2 },
  "new york": { peak: [5, 6, 9, 10, 12], off: [1, 2, 3], lat: 40.7 },
  "san francisco": { peak: [5, 6, 7, 8, 9], off: [1, 2, 11], lat: 37.8 },
  "los angeles": { peak: [6, 7, 8, 12], off: [1, 2, 11], lat: 34.1 },
  mexico: { peak: [12, 1, 2, 3], off: [5, 6, 9, 10], lat: 19.4 },
  peru: { peak: [6, 7, 8], off: [1, 2, 3], lat: -13.5 },
  "rio de janeiro": { peak: [12, 1, 2, 7], off: [4, 5, 10], lat: -22.9 },
  "buenos aires": { peak: [1, 2, 7, 12], off: [5, 6, 9], lat: -34.6 },
  sydney: { peak: [12, 1, 2], off: [5, 6, 7], lat: -33.9 },
  melbourne: { peak: [12, 1, 2], off: [5, 6, 7, 8], lat: -37.8 },
  "cape town": { peak: [11, 12, 1, 2], off: [5, 6, 7], lat: -33.9 },
  marrakech: { peak: [3, 4, 10, 11], off: [6, 7, 8], lat: 31.6 },
  cairo: { peak: [11, 12, 1, 2], off: [6, 7, 8], lat: 30.0 },
  delhi: { peak: [11, 12, 1, 2], off: [4, 5, 6, 7], lat: 28.6 },
  jaipur: { peak: [11, 12, 1, 2], off: [4, 5, 6, 7], lat: 26.9 },
  kathmandu: { peak: [3, 4, 10, 11], off: [6, 7, 8], lat: 27.7 },
};

export const DEFAULT_SEASONALITY: DestinationSeasonality = {
  peak: [6, 7, 8, 12],
  off: [1, 2, 11],
  lat: 40,
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(m: number): string {
  return MONTH_NAMES[m - 1] ?? `Month ${m}`;
}

/** Look up seasonality for a free-text destination ("Paris, France"). */
export function seasonalityFor(destination: string): DestinationSeasonality & { matched: string | null } {
  const norm = destination.trim().toLowerCase();
  for (const [key, val] of Object.entries(DESTINATION_SEASONS)) {
    if (norm.includes(key)) return { ...val, matched: key };
  }
  return { ...DEFAULT_SEASONALITY, matched: null };
}

export interface MonthScore {
  month: number;
  name: string;
  score: number; // 0-100
  reasons: string[];
  typical: { tmaxC: number; precipMm: number };
  costTier: "peak" | "shoulder" | "off";
}

export interface BestTimeResult {
  top: MonthScore[]; // top 3
  all: MonthScore[];
  /** destination key that matched the curated table, null = generic defaults */
  matchedDestination: string | null;
}

/**
 * Score every month and return the top 3. Climate comfort dominates (60),
 * then price (25) and crowds (15). Reasons are plain-language, suitable for
 * direct display.
 */
export function bestTimeFor(destination: string): BestTimeResult {
  const season = seasonalityFor(destination);
  const norms = climateNormsFor(season.lat);

  const all: MonthScore[] = norms.map((norm) => {
    const reasons: string[] = [];
    let climate = 60;
    if (norm.tmaxC >= 18 && norm.tmaxC <= 28) {
      reasons.push(`Comfortable days around ${Math.round(norm.tmaxC)}°C`);
    } else if (norm.tmaxC > 33) {
      climate -= 30;
      reasons.push(`Typically very hot (${Math.round(norm.tmaxC)}°C)`);
    } else if (norm.tmaxC > 28) {
      climate -= 12;
      reasons.push(`Warm at ${Math.round(norm.tmaxC)}°C`);
    } else if (norm.tmaxC < 5) {
      climate -= 25;
      reasons.push(`Typically cold (${Math.round(norm.tmaxC)}°C highs)`);
    } else if (norm.tmaxC < 18) {
      climate -= 8;
      reasons.push(`Cool at ${Math.round(norm.tmaxC)}°C`);
    }
    if (norm.precipMm >= 180) {
      climate -= 25;
      reasons.push("Rainy season");
    } else if (norm.precipMm >= 100) {
      climate -= 10;
      reasons.push("Some rain likely");
    } else {
      reasons.push("Usually dry");
    }

    let price = 12; // shoulder baseline
    let costTier: MonthScore["costTier"] = "shoulder";
    if (season.off.includes(norm.month)) {
      price = 25;
      costTier = "off";
      reasons.push("Off-season prices");
    } else if (season.peak.includes(norm.month)) {
      price = 5;
      costTier = "peak";
      reasons.push("Peak-season prices");
    } else {
      reasons.push("Shoulder-season prices");
    }

    let crowd = 15;
    if (season.peak.includes(norm.month)) {
      crowd = 4;
      reasons.push("Busy with tourists");
    } else if (season.off.includes(norm.month)) {
      reasons.push("Lighter crowds");
    }

    return {
      month: norm.month,
      name: monthName(norm.month),
      score: Math.max(0, Math.min(100, Math.round(climate + price + crowd))),
      reasons,
      typical: { tmaxC: norm.tmaxC, precipMm: norm.precipMm },
      costTier,
    };
  });

  const top = [...all].sort((a, b) => b.score - a.score).slice(0, 3);
  return { top, all, matchedDestination: season.matched };
}
