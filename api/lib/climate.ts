/**
 * climate.ts (r24-smart) - month-by-month "typical climate" norms from a
 * latitude band model. Used when a date sits beyond the 16-day forecast
 * horizon (weather advice) and by the wishlist best-time advisor.
 *
 * Deliberately simple and honest: four latitude bands with a seasonal
 * amplitude phased by hemisphere, plus a per-band precipitation pattern.
 * Every consumer labels this output "typical" - it is a heuristic, never a
 * forecast.
 */

export interface ClimateMonthNorm {
  /** 1-12 */
  month: number;
  /** typical daytime high, C */
  tmaxC: number;
  /** typical monthly precipitation, mm */
  precipMm: number;
}

type Band = {
  /** mean annual daytime high, C */
  base: number;
  /** seasonal swing half-amplitude, C */
  amp: number;
  /** wettest-month precip, mm (driest is roughly a third of this) */
  wetMm: number;
  /** "summer" = rain peaks in local summer (monsoon); "winter" = mediterranean; "even" = no strong season */
  rainSeason: "summer" | "winter" | "even";
};

function bandFor(absLat: number): Band {
  if (absLat < 15) return { base: 31, amp: 3, wetMm: 280, rainSeason: "summer" };
  if (absLat < 30) return { base: 27, amp: 9, wetMm: 140, rainSeason: "summer" };
  if (absLat < 40) return { base: 23, amp: 11, wetMm: 90, rainSeason: "winter" };
  if (absLat < 55) return { base: 15, amp: 12, wetMm: 80, rainSeason: "even" };
  return { base: 7, amp: 15, wetMm: 70, rainSeason: "even" };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Typical climate for a latitude, 12 months. Hemisphere flips the seasonal
 * phase: the warmest month is July up north, January down south.
 */
export function climateNormsFor(lat: number): ClimateMonthNorm[] {
  const band = bandFor(Math.abs(lat));
  const north = lat >= 0;
  // Peak-warm month: 7 (Jul) north, 1 (Jan) south.
  const warmPeak = north ? 7 : 1;
  // Wet month depends on the rain regime and hemisphere.
  const wetPeak =
    band.rainSeason === "even" ? null : band.rainSeason === "summer" ? warmPeak : ((warmPeak + 6 - 1) % 12) + 1;

  const out: ClimateMonthNorm[] = [];
  for (let m = 1; m <= 12; m++) {
    const phase = Math.cos(((m - warmPeak) / 12) * 2 * Math.PI);
    const tmaxC = round1(band.base + band.amp * phase);
    let precipMm: number;
    if (wetPeak == null) {
      precipMm = band.wetMm * 0.75; // even regime: roughly constant
    } else {
      const rainPhase = Math.cos(((m - wetPeak) / 12) * 2 * Math.PI); // +1 wettest, -1 driest
      precipMm = band.wetMm * (0.65 + 0.35 * rainPhase);
    }
    out.push({ month: m, tmaxC, precipMm: Math.round(precipMm) });
  }
  return out;
}

/** Typical-climate stand-in for one date when the forecast horizon is exceeded. */
export function typicalDay(lat: number, dateISO: string): { tmaxC: number; precipMm: number } | null {
  const m = Number(dateISO.slice(5, 7));
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  const norm = climateNormsFor(lat)[m - 1]!;
  // Convert monthly precip into a rough "probability of a wet day" so callers
  // can reuse the same thresholds as real forecasts (saturated at 90%).
  return { tmaxC: norm.tmaxC, precipMm: norm.precipMm };
}

/** Rough wet-day probability (%) from a monthly precip total. */
export function wetDayChancePct(monthlyPrecipMm: number): number {
  // ~100mm/month is roughly 8-10 wet days (~30%); scale and clamp.
  return Math.min(90, Math.round(monthlyPrecipMm * 0.3));
}
