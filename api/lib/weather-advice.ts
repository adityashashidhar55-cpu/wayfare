/**
 * weather-advice.ts (r24-smart, feature K) - pure analyzer that turns per-day
 * trip forecasts into flags and concrete adaptations. No I/O; fully tested.
 *
 * Thresholds (from the roadmap): hot above 33C, rainy above 60% precipitation
 * probability, cold below 5C. Days beyond the forecast horizon arrive as
 * "approximate" typical-climate rows and are labeled as such.
 */

export const HOT_C = 33;
export const RAINY_PCT = 60;
export const COLD_C = 5;

export type WeatherFlag = "hot" | "rainy" | "cold";

export interface ForecastDay {
  dayId: number;
  /** YYYY-MM-DD */
  date: string;
  /** daytime high, C (null = no data) */
  tmaxC: number | null;
  /** precipitation probability 0-100 (null = no data) */
  precipProbPct: number | null;
  /** true = typical-climate heuristic, not a real forecast */
  approximate: boolean;
  /** number of outdoor stops planned this day */
  outdoorCount: number;
}

export interface FlaggedDay {
  dayId: number;
  date: string;
  flags: WeatherFlag[];
  approximate: boolean;
  tmaxC: number | null;
  precipProbPct: number | null;
}

export type Adaptation =
  | { kind: "indoor"; dayId: number; text: string }
  | { kind: "lighter"; dayId: number; text: string }
  | { kind: "swap"; dayId: number; withDayId: number; text: string }
  | { kind: "flexible"; dayId: number; text: string };

export interface WeatherAdvice {
  flagged: FlaggedDay[];
  adaptations: Adaptation[];
  /** true when every day is typical-climate data */
  approximateAll: boolean;
}

export function flagsFor(d: ForecastDay): WeatherFlag[] {
  const flags: WeatherFlag[] = [];
  if (d.tmaxC != null && d.tmaxC > HOT_C) flags.push("hot");
  if (d.precipProbPct != null && d.precipProbPct > RAINY_PCT) flags.push("rainy");
  if (d.tmaxC != null && d.tmaxC < COLD_C) flags.push("cold");
  return flags;
}

function fmtTemp(c: number): string {
  return `${Math.round(c)}°C`;
}

/**
 * Analyze a whole trip. Days are compared pairwise for the swap suggestion:
 * a rainy/hot day swapped with the clearest later day (clear = no flags,
 * precipitation at least 30 points lower).
 */
export function analyzeForecast(days: ForecastDay[]): WeatherAdvice {
  const flagged: FlaggedDay[] = [];
  const adaptations: Adaptation[] = [];
  const usable = days.filter((d) => d.tmaxC != null || d.precipProbPct != null);
  const approximateAll = usable.length > 0 && usable.every((d) => d.approximate);

  const clearDays = days.filter((d) => flagsFor(d).length === 0 && (d.tmaxC != null || d.precipProbPct != null));

  for (const d of days) {
    const flags = flagsFor(d);
    if (flags.length === 0) continue;
    flagged.push({
      dayId: d.dayId,
      date: d.date,
      flags,
      approximate: d.approximate,
      tmaxC: d.tmaxC,
      precipProbPct: d.precipProbPct,
    });

    const typical = d.approximate ? "typically " : "";
    if (flags.includes("rainy") && d.outdoorCount > 0) {
      adaptations.push({
        kind: "indoor",
        dayId: d.dayId,
        text: `Rain is ${typical}likely (${d.precipProbPct}% chance). Swap an outdoor stop for an indoor alternative nearby.`,
      });
    }
    if (flags.includes("hot")) {
      adaptations.push({
        kind: "lighter",
        dayId: d.dayId,
        text: `${typical === "" ? "Hot" : "Typically hot"} at ${d.tmaxC != null ? fmtTemp(d.tmaxC) : "high heat"}, plan fewer walking stretches and shade breaks.`,
      });
    }
    if (flags.includes("cold") && d.outdoorCount > 0) {
      adaptations.push({
        kind: "lighter",
        dayId: d.dayId,
        text: `${typical === "" ? "Cold" : "Typically cold"} at ${d.tmaxC != null ? fmtTemp(d.tmaxC) : "low temperatures"}, keep outdoor blocks short.`,
      });
    }

    // Swap suggestion: this day is flagged (rain takes priority) and a clear
    // day exists with markedly lower precipitation.
    if (flags.includes("rainy")) {
      const target = clearDays
        .filter((c) => c.dayId !== d.dayId && (c.precipProbPct ?? 0) + 30 <= (d.precipProbPct ?? 100))
        .sort((a, b) => (a.precipProbPct ?? 0) - (b.precipProbPct ?? 0))[0];
      if (target) {
        adaptations.push({
          kind: "swap",
          dayId: d.dayId,
          withDayId: target.dayId,
          text: `Swap with ${target.date}, which looks clearer (${target.precipProbPct ?? 0}% rain chance).`,
        });
      }
    }

    if (flags.length > 0) {
      adaptations.push({
        kind: "flexible",
        dayId: d.dayId,
        text: "Or mark the day flexible and decide on the morning of.",
      });
    }
  }

  return { flagged, adaptations, approximateAll };
}
