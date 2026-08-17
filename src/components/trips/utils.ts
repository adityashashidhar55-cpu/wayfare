import { differenceInCalendarDays } from 'date-fns';
import type { Trip, TripMember } from '@contracts/types';
import { poolImageFor } from '@/lib/place-images';

/** Trip shape returned by trpc.trips.list (status: 'upcoming' | 'past'). */
export type ListedTrip = Trip & { members: TripMember[]; status: string };

/** Cover options offered by the create-trip modal (design.md §14). */
export const COVER_OPTIONS = [
  '/cover-lisbon.jpg',
  '/cover-amalfi.jpg',
  '/cover-marrakech.jpg',
  '/cover-patagonia.jpg',
  '/cover-reykjavik.jpg',
  '/cover-copenhagen.jpg',
  '/cover-oaxaca.jpg',
] as const;

export const DEFAULT_COVER = '/hero-kyoto.jpg';

/**
 * Trip card cover: the trip's own cover first; otherwise a destination-aware
 * pool pick (a Bengaluru trip gets a South-Asian frame, never the Kyoto hero
 * on every card). DEFAULT_COVER only when the destination is unusable.
 */
export function tripCoverFor(
  coverImage: string | null | undefined,
  destination: string | null | undefined,
): string {
  if (coverImage) return coverImage;
  if (destination?.trim()) {
    const [city, ...rest] = destination.split(',');
    const pooled = poolImageFor({
      category: 'cityscape',
      name: destination,
      city: city?.trim() || destination,
      country: rest.join(',').trim() || destination,
      lat: null,
      lng: null,
    });
    if (pooled) return pooled;
  }
  return DEFAULT_COVER;
}

/** Place thumbnails used as fallbacks for bucket-list cards. */
export const PLACE_THUMBS = [
  '/place-ramen.jpg',
  '/place-temple.jpg',
  '/place-cafe.jpg',
  '/place-museum.jpg',
  '/place-market.jpg',
  '/place-hike.jpg',
  '/place-onsen.jpg',
  '/place-bar.jpg',
] as const;

/** Deterministic fallback thumb for a named place (stable pick, not random). */
export function thumbFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PLACE_THUMBS[h % PLACE_THUMBS.length];
}

/* ------------------------------ dates ------------------------------ */

/** Parse a YYYY-MM-DD string as a LOCAL date (avoids UTC off-by-one). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Apr 4–13" · "Apr 28 – May 3" · "Dec 28, 2025 – Jan 3, 2026". */
export function formatDateRange(startIso: string, endIso: string, opts?: { withYear?: boolean }): string {
  const s = parseDay(startIso);
  const e = parseDay(endIso);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  const yr = opts?.withYear ? `, ${e.getFullYear()}` : '';
  if (sameMonth) return `${MONTHS[s.getMonth()]} ${s.getDate()}–${e.getDate()}${yr}`;
  if (sameYear) return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}${yr}`;
  return `${MONTHS[s.getMonth()]} ${s.getDate()}, ${s.getFullYear()} – ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

/** "Apr 4" / "Apr 4, 2026". */
export function formatSingleDay(iso: string, opts?: { withYear?: boolean }): string {
  const d = parseDay(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${opts?.withYear ? `, ${d.getFullYear()}` : ''}`;
}

export function tripNights(startIso: string, endIso: string): number {
  return Math.max(0, differenceInCalendarDays(parseDay(endIso), parseDay(startIso)));
}

export function tripDays(startIso: string, endIso: string): number {
  return tripNights(startIso, endIso) + 1;
}

export function daysUntil(startIso: string): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return differenceInCalendarDays(parseDay(startIso), t);
}

export function isUnderway(startIso: string, endIso: string): boolean {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return parseDay(startIso) <= t && t <= parseDay(endIso);
}

/** Countdown chip label (dashboard §S2). */
export function countdownLabel(startIso: string, endIso: string): string {
  if (isUnderway(startIso, endIso)) {
    const dayN = differenceInCalendarDays(new Date(), parseDay(startIso)) + 1;
    return `Underway · day ${dayN} of ${tripDays(startIso, endIso)}`;
  }
  const d = daysUntil(startIso);
  if (d <= 0) return 'Leaves today';
  if (d === 1) return '1 day away';
  return `${d} days away`;
}

/* ---------------------------- identity ----------------------------- */

export function firstName(name?: string | null): string {
  if (!name) return 'Traveler';
  return name.trim().split(/\s+/)[0] ?? 'Traveler';
}

/** Derive a calm handle from the user's email or name. */
export function handleFor(user: { name?: string | null; email?: string | null }): string {
  const base =
    user.email?.split('@')[0]?.toLowerCase().replace(/[^a-z0-9._]+/g, '.') ||
    (user.name ?? 'traveler').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return `@${base || 'traveler'}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/* --------------------------- countries ----------------------------- */

export type CityRef = { city: string; country: string };

/**
 * Resolve unique countries from free-text trip destinations using the real
 * explore city directory (city → country). Tokens that already name a known
 * country are accepted directly.
 */
export function extractCountries(destinations: string[], directory: CityRef[]): string[] {
  const byCity = new Map(directory.map((c) => [c.city.toLowerCase(), c.country]));
  const countryCanon = new Map(directory.map((c) => [c.country.toLowerCase(), c.country]));
  const out = new Map<string, string>();
  for (const dest of destinations) {
    const tokens = dest
      .split(/[,·|/&]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (const token of tokens) {
      const lc = token.toLowerCase();
      const country = byCity.get(lc) ?? countryCanon.get(lc);
      if (country) out.set(country.toLowerCase(), country);
    }
  }
  return [...out.values()];
}

/**
 * Anchor positions (percent of the 1200×600 world-dots.svg artboard) for the
 * stylized dotted map. Presentation constants only - the set of countries and
 * trip counts are always real API data.
 */
export const COUNTRY_ANCHORS: Record<string, [number, number]> = {
  'united states': [14, 25],
  usa: [14, 25],
  canada: [13, 14],
  mexico: [13, 37.5],
  brazil: [35, 47],
  argentina: [32.5, 57.5],
  peru: [30, 49],
  chile: [31.5, 58],
  colombia: [29, 41],
  iceland: [36.5, 11],
  'united kingdom': [39, 15],
  uk: [39, 15],
  ireland: [38, 15],
  france: [40, 23],
  spain: [39, 32],
  portugal: [38, 32],
  italy: [42.5, 27],
  germany: [41.5, 18],
  netherlands: [41, 15],
  belgium: [40.5, 17],
  switzerland: [41, 22],
  austria: [42.5, 21],
  czechia: [43, 18],
  'czech republic': [43, 18],
  poland: [43.5, 17],
  croatia: [43, 24],
  greece: [43.8, 29],
  denmark: [42, 12.5],
  norway: [40.8, 11],
  sweden: [42, 11],
  finland: [43.8, 11],
  turkey: [46.5, 29],
  morocco: [47.5, 37.5],
  egypt: [53, 35],
  'south africa': [53, 56],
  kenya: [55, 47],
  tanzania: [54.5, 50],
  'united arab emirates': [61, 33],
  uae: [61, 33],
  india: [66, 36],
  nepal: [66.5, 30],
  thailand: [71, 38],
  vietnam: [72.5, 37],
  malaysia: [72, 43],
  singapore: [72.5, 45],
  indonesia: [73, 47],
  china: [73, 23],
  japan: [84, 22.5],
  'south korea': [81, 24],
  korea: [81, 24],
  australia: [86.5, 50],
  'new zealand': [95, 61],
};

export function anchorFor(country: string): [number, number] | undefined {
  return COUNTRY_ANCHORS[country.toLowerCase()];
}

/* ------------------------- taste profile --------------------------- */

export const STYLE_LABELS: Record<string, string> = {
  adventure: 'Adventure',
  food: 'Food & drink',
  budget: 'Budget-friendly',
  historical: 'Historical',
  relaxing: 'Relaxing',
};

export const PACE_INFO: Record<string, { label: string; stops: string; detent: number }> = {
  relaxed: { label: 'Relaxed', stops: '≈2 stops/day', detent: 2 },
  balanced: { label: 'Balanced', stops: '≈4 stops/day', detent: 3 },
  packed: { label: 'Packed', stops: '≈6 stops/day', detent: 5 },
};

/** Pace options in slider order (for the editable pace control). */
export const PACE_OPTIONS = ['relaxed', 'balanced', 'packed'] as const;

export const BUDGET_BANDS: { value: string; label: string; caption: string }[] = [
  { value: 'shoestring', label: 'Shoestring', caption: 'Hostels & street food' },
  { value: 'mid', label: 'Mid-range', caption: 'Comfortable, not fussy' },
  { value: 'comfort', label: 'Comfort', caption: 'Boutique stays, nice tables' },
  { value: 'luxury', label: 'Luxury', caption: 'The good stuff' },
];
