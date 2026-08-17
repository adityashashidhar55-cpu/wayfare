/**
 * Timezone-aware "today".
 *
 * WHY THIS EXISTS. Every date boundary in the API used to be:
 *
 *     new Date().toISOString().slice(0, 10)   // server UTC
 *
 * IST is UTC+05:30. Between 00:00 and 05:29 IST every morning, the server's
 * "today" is still yesterday's calendar date. For an India-first product that
 * broke real features for five and a half hours a day:
 *   - geo.todayStops returned YESTERDAY's stops, so arrival detection showed
 *     nothing for the day actually in progress
 *   - a trip ending "today" still reported status "upcoming"
 *   - templates / travel / social all rolled over late
 *
 * These helpers resolve the calendar date in a specific IANA zone using
 * Intl.DateTimeFormat, which ships with Node and needs no dependency and no
 * tzdata of our own.
 *
 * Resolution order for "which zone?" is always: trip.timezone -> user.timezone
 * -> APP_DEFAULT_TZ -> Asia/Kolkata.
 */

/** Fallback when neither the trip nor the user has a zone set. */
export const DEFAULT_TZ = process.env.APP_DEFAULT_TZ || "Asia/Kolkata";

/** Cache formatters - constructing Intl.DateTimeFormat is not cheap. */
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function isoFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** True if the runtime recognises this IANA zone name. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the zone to use, most specific first. Invalid or unknown values are
 * skipped rather than thrown, so a bad row can never 500 a request.
 */
export function resolveTz(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    if (isValidTimeZone(c)) return c;
  }
  return isValidTimeZone(DEFAULT_TZ) ? DEFAULT_TZ : "UTC";
}

/**
 * Calendar date (YYYY-MM-DD) as it currently reads in `timeZone`.
 * en-CA formats as YYYY-MM-DD, which is exactly the shape stored in
 * trips.startDate / trips.endDate / tripDays.date.
 */
export function todayIn(timeZone?: string | null, at: Date = new Date()): string {
  return isoFormatter(resolveTz(timeZone)).format(at);
}

/** Minutes since local midnight in `timeZone` - for "is this stop now?" logic. */
export function minutesOfDayIn(timeZone?: string | null, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveTz(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** `days` before/after today in `timeZone`, as YYYY-MM-DD. */
export function dateOffsetIn(days: number, timeZone?: string | null, at: Date = new Date()): string {
  return todayIn(timeZone, new Date(at.getTime() + days * 86_400_000));
}

/**
 * Best-effort zone for a destination, used when creating a trip so the trip
 * gets a sensible zone without asking the traveller.
 *
 * Deliberately small and honest: it covers the markets Wayfare actually serves
 * and returns null for anything else rather than guessing. A null simply falls
 * through to the user's zone and then the app default.
 */
const COUNTRY_TZ: Record<string, string> = {
  india: "Asia/Kolkata",
  "sri lanka": "Asia/Colombo",
  nepal: "Asia/Kathmandu",
  bhutan: "Asia/Thimphu",
  bangladesh: "Asia/Dhaka",
  maldives: "Indian/Maldives",
  thailand: "Asia/Bangkok",
  vietnam: "Asia/Ho_Chi_Minh",
  singapore: "Asia/Singapore",
  malaysia: "Asia/Kuala_Lumpur",
  indonesia: "Asia/Jakarta",
  japan: "Asia/Tokyo",
  "south korea": "Asia/Seoul",
  china: "Asia/Shanghai",
  "hong kong": "Asia/Hong_Kong",
  "united arab emirates": "Asia/Dubai",
  uae: "Asia/Dubai",
  qatar: "Asia/Qatar",
  "saudi arabia": "Asia/Riyadh",
  turkey: "Europe/Istanbul",
  "united kingdom": "Europe/London",
  uk: "Europe/London",
  ireland: "Europe/Dublin",
  france: "Europe/Paris",
  germany: "Europe/Berlin",
  spain: "Europe/Madrid",
  italy: "Europe/Rome",
  portugal: "Europe/Lisbon",
  netherlands: "Europe/Amsterdam",
  switzerland: "Europe/Zurich",
  austria: "Europe/Vienna",
  greece: "Europe/Athens",
  denmark: "Europe/Copenhagen",
  norway: "Europe/Oslo",
  sweden: "Europe/Stockholm",
  "czech republic": "Europe/Prague",
  czechia: "Europe/Prague",
  poland: "Europe/Warsaw",
  hungary: "Europe/Budapest",
  morocco: "Africa/Casablanca",
  egypt: "Africa/Cairo",
  "south africa": "Africa/Johannesburg",
  kenya: "Africa/Nairobi",
  tanzania: "Africa/Dar_es_Salaam",
  australia: "Australia/Sydney",
  "new zealand": "Pacific/Auckland",
  mexico: "America/Mexico_City",
  brazil: "America/Sao_Paulo",
  argentina: "America/Argentina/Buenos_Aires",
  peru: "America/Lima",
  chile: "America/Santiago",
  colombia: "America/Bogota",
  canada: "America/Toronto",
};

/**
 * Guess a zone from a free-text destination like "Coorg, India" or "Kyoto,
 * Japan". Returns null when there's no confident match - callers fall back
 * rather than storing a wrong zone.
 *
 * The USA is intentionally absent: it spans six zones, so a country-level
 * guess would be wrong more often than right.
 */
export function guessTimeZone(destination?: string | null, country?: string | null): string | null {
  const haystack = `${country ?? ""} ${destination ?? ""}`.toLowerCase();
  if (!haystack.trim()) return null;
  // Longest key first so "sri lanka" isn't shadowed by a shorter match.
  const keys = Object.keys(COUNTRY_TZ).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (haystack.includes(key)) return COUNTRY_TZ[key];
  }
  return null;
}
