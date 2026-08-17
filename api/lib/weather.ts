// api/lib/weather.ts - Open-Meteo weather for trip dates.
//
// Two tiers, both free & keyless:
//   1. Forecast API  - real forecast, up to 16 days ahead.
//   2. Archive API   - for dates beyond the forecast horizon, average the same
//      calendar day across the last 5 years ("typical climate", approximate).
//
// Every lookup is cached persistently in the api_cache table (api/lib/cache.ts):
// 6h TTL for real forecasts, 7d for climate normals - so a trip's day chips
// cost one fetch and repeat views never hit Open-Meteo again.

import { cacheGet, cacheSet } from "./cache";
import { fetchJson as fetchJsonSafe } from "./http";

export type DayWeather = {
  date: string; // YYYY-MM-DD
  tmaxC: number;
  tminC: number;
  precipMm: number;
  code: number; // WMO weather code
  approximate: boolean; // true when derived from climate normals
};

const TTL_FORECAST = 6 * 60 * 60 * 1000; // 6h - real forecast refreshes a few times a day
const TTL_NORMALS = 7 * 24 * 60 * 60 * 1000; // 7d - 5-year climate normals barely change

const round1 = (n: number) => Math.round(n * 10) / 10;

async function fetchJson(url: string): Promise<any> {
  // Shared safe fetcher: typed ExternalApiError on HTTP/non-JSON/timeout -
  // getDayWeather's try/catch turns any of those into a null chip.
  return fetchJsonSafe(url, { timeoutMs: 12000, service: "open-meteo" });
}

/** WMO code → short label + icon hint for the UI. */
export function weatherLabel(code: number): { label: string; icon: string } {
  if (code === 0) return { label: "Clear", icon: "sun" };
  if (code <= 2) return { label: "Partly cloudy", icon: "cloud-sun" };
  if (code === 3) return { label: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "cloud-fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "cloud-drizzle" };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "cloud-rain" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "cloud-snow" };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: "cloud-showers" };
  if (code >= 85 && code <= 86) return { label: "Snow showers", icon: "cloud-snow" };
  if (code >= 95) return { label: "Thunderstorms", icon: "cloud-lightning" };
  return { label: "Mixed", icon: "cloud" };
}

/**
 * Weather for one calendar day at a point. Never throws - returns null when
 * Open-Meteo is unreachable so the UI can simply hide the chip.
 */
export async function getDayWeather(
  lat: number,
  lng: number,
  dateISO: string,
): Promise<DayWeather | null> {
  const today = new Date();
  const dayStart = new Date(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
  const target = new Date(`${dateISO}T00:00:00`);
  const daysAhead = Math.round((target.getTime() - dayStart.getTime()) / 86400000);

  // Persistent cache: `wx:f:` real forecast (6h), `wx:n:` climate normals (7d).
  const isNormals = daysAhead > 15;
  const key = `wx:${isNormals ? "n" : "f"}:${lat.toFixed(2)},${lng.toFixed(2)}:${dateISO}`;
  const hit = await cacheGet<DayWeather>(key);
  if (hit !== null) return hit;

  let value: DayWeather | null = null;
  try {
    if (daysAhead >= 0 && daysAhead <= 15) {
      const j = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
          `&start_date=${dateISO}&end_date=${dateISO}&timezone=auto`,
      );
      const d = j?.daily;
      if (d?.time?.[0]) {
        value = {
          date: dateISO,
          tmaxC: round1(d.temperature_2m_max[0]),
          tminC: round1(d.temperature_2m_min[0]),
          precipMm: round1(d.precipitation_sum[0] ?? 0),
          code: d.weather_code[0] ?? 0,
          approximate: false,
        };
      }
    } else if (daysAhead > 15) {
      // Climate normals: same calendar day across the last 5 years.
      const [Y, M, D] = dateISO.split("-").map(Number);
      const years = [1, 2, 3, 4, 5].map((k) => Y - k);
      const rows: DayWeather[] = [];
      // One request covering the earliest-to-latest span keeps this to a single fetch.
      const start = `${years[years.length - 1]}-${String(M).padStart(2, "0")}-${String(D).padStart(2, "0")}`;
      const end = `${years[0]}-${String(M).padStart(2, "0")}-${String(D).padStart(2, "0")}`;
      const j = await fetchJson(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
          `&start_date=${start}&end_date=${end}&timezone=auto`,
      );
      const d = j?.daily;
      if (d?.time?.length) {
        // Pick the entry for each year's matching month-day.
        for (const y of years) {
          const want = `${y}-${String(M).padStart(2, "0")}-${String(D).padStart(2, "0")}`;
          const idx = d.time.indexOf(want);
          if (idx >= 0) {
            rows.push({
              date: dateISO,
              tmaxC: d.temperature_2m_max[idx],
              tminC: d.temperature_2m_min[idx],
              precipMm: d.precipitation_sum[idx] ?? 0,
              code: d.weather_code[idx] ?? 0,
              approximate: true,
            });
          }
        }
      }
      if (rows.length) {
        const avg = (f: (r: DayWeather) => number) =>
          round1(rows.reduce((a, r) => a + f(r), 0) / rows.length);
        // Modal weather code (most common condition across years).
        const freq = new Map<number, number>();
        rows.forEach((r) => freq.set(r.code, (freq.get(r.code) ?? 0) + 1));
        const code = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
        value = {
          date: dateISO,
          tmaxC: avg((r) => r.tmaxC),
          tminC: avg((r) => r.tminC),
          precipMm: avg((r) => r.precipMm),
          code,
          approximate: true,
        };
      }
    }
  } catch {
    value = null;
  }

  if (value) await cacheSet(key, value, isNormals ? TTL_NORMALS : TTL_FORECAST);
  return value;
}
