/**
 * forecast.ts (r24-smart, feature K) - date-range forecasts with
 * precipitation probability for the weather-advisory analyzer. Real
 * Open-Meteo forecasts inside the 16-day horizon, typical-climate heuristics
 * (api/lib/climate.ts, labeled "typical") beyond it. Never throws; cached in
 * api_cache like the day-weather lookups.
 */
import { cacheGet, cacheSet } from "./cache";
import { fetchJson } from "./http";
import { climateNormsFor, wetDayChancePct } from "./climate";

export interface ForecastPoint {
  date: string; // YYYY-MM-DD
  tmaxC: number | null;
  precipProbPct: number | null; // 0-100
  approximate: boolean; // true = typical climate, not a forecast
}

const TTL_FORECAST = 6 * 60 * 60 * 1000;
const TTL_NORMALS = 7 * 24 * 60 * 60 * 1000;

/** Days from today (local) to a YYYY-MM-DD date. */
export function daysAheadOf(dateISO: string, now: Date = new Date()): number {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(`${dateISO}T00:00:00`);
  return Math.round((target.getTime() - dayStart.getTime()) / 86400000);
}

async function fetchForecastRange(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<Map<string, { tmaxC: number; precipProbPct: number }>> {
  const key = `wxf2:${lat.toFixed(2)},${lng.toFixed(2)}:${startDate}:${endDate}`;
  const hit = await cacheGet<[string, { tmaxC: number; precipProbPct: number }][]>(key);
  if (hit !== null) return new Map(hit);
  const map = new Map<string, { tmaxC: number; precipProbPct: number }>();
  try {
    const j = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
        `&daily=temperature_2m_max,precipitation_probability_max` +
        `&start_date=${startDate}&end_date=${endDate}&timezone=auto`,
      { timeoutMs: 12000, service: "open-meteo" },
    );
    const d = (j as any)?.daily;
    if (d?.time?.length) {
      for (let i = 0; i < d.time.length; i++) {
        map.set(d.time[i], {
          tmaxC: Math.round((d.temperature_2m_max[i] ?? 0) * 10) / 10,
          precipProbPct: Math.round(d.precipitation_probability_max[i] ?? 0),
        });
      }
    }
  } catch {
    // unreachable API -> empty map, callers produce null rows
  }
  if (map.size) await cacheSet(key, [...map.entries()], TTL_FORECAST);
  return map;
}

/** Typical-climate stand-ins for dates beyond the forecast horizon. */
async function typicalPoints(lat: number, dates: string[]): Promise<Map<string, ForecastPoint>> {
  const key = `wxn2:${lat.toFixed(1)}:${dates.join(",")}`;
  const hit = await cacheGet<[string, ForecastPoint][]>(key);
  if (hit !== null) return new Map(hit);
  const norms = climateNormsFor(lat);
  const map = new Map<string, ForecastPoint>();
  for (const date of dates) {
    const m = Number(date.slice(5, 7));
    if (!Number.isFinite(m) || m < 1 || m > 12) continue;
    const norm = norms[m - 1]!;
    map.set(date, {
      date,
      tmaxC: norm.tmaxC,
      precipProbPct: wetDayChancePct(norm.precipMm),
      approximate: true,
    });
  }
  await cacheSet(key, [...map.entries()], TTL_NORMALS);
  return map;
}

/**
 * Forecast (or typical climate) for a set of dates at a point. Real forecast
 * for dates 0..15 days out, typical-climate heuristics beyond that; missing
 * data yields null fields so callers can degrade gracefully.
 */
export async function forecastForDates(
  lat: number,
  lng: number,
  dates: string[],
): Promise<ForecastPoint[]> {
  const unique = [...new Set(dates)].sort();
  const realDates = unique.filter((d) => {
    const ahead = daysAheadOf(d);
    return ahead >= 0 && ahead <= 15;
  });
  const farDates = unique.filter((d) => daysAheadOf(d) > 15);

  const out = new Map<string, ForecastPoint>();
  if (realDates.length) {
    const fetched = await fetchForecastRange(lat, lng, realDates[0]!, realDates[realDates.length - 1]!);
    for (const d of realDates) {
      const v = fetched.get(d);
      out.set(d, { date: d, tmaxC: v?.tmaxC ?? null, precipProbPct: v?.precipProbPct ?? null, approximate: false });
    }
  }
  if (farDates.length) {
    const typical = await typicalPoints(lat, farDates);
    for (const d of farDates) {
      out.set(d, typical.get(d) ?? { date: d, tmaxC: null, precipProbPct: null, approximate: true });
    }
  }
  return dates.map((d) => out.get(d) ?? { date: d, tmaxC: null, precipProbPct: null, approximate: false });
}
