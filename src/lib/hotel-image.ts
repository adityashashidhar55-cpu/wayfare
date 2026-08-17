/**
 * Hotel photo resolution - hotels rarely have a usable image URL in the
 * platform, so we resolve one on demand with a strict fallback chain and
 * NEVER render a broken <img>:
 *
 *   1) Wikipedia/Wikimedia: famous + chain hotels usually have an article
 *      with a photo (action=query · generator=search · pageimages thumb).
 *      Results are cached (in-memory + localStorage), including misses, so
 *      a hotel is looked up at most once per browser.
 *   2) Deterministic real-photo pool for the 'lodging' category via
 *      placeImageFor (tags hint) - returns null until the shared image lib
 *      grows a lodging pool, then it just starts working.
 *   3) null → the UI shows its monogram tile instead of any image.
 *
 * Every step fails soft; a hotel with no photo simply gets no photo.
 */

import { placeImageFor } from "./place-images";

const memCache = new Map<string, string | null>();
const LS_PREFIX = "wf-hotelimg:";

function lsGet(key: string): string | null | undefined {
  try {
    const v = window.localStorage.getItem(LS_PREFIX + key);
    if (v === null) return undefined; // never looked up
    return v === "" ? null : v; // "" = known miss
  } catch {
    return undefined;
  }
}

function lsSet(key: string, url: string | null): void {
  try {
    window.localStorage.setItem(LS_PREFIX + key, url ?? "");
  } catch {
    // storage full / private mode - memory cache still applies
  }
}

interface WikipediaQueryResponse {
  query?: {
    pages?: Record<
      string,
      { title?: string; thumbnail?: { source?: string } }
    >;
  };
}

/**
 * Best-effort Wikipedia photo for a hotel name ("Park Hyatt Kyoto").
 * Searches article titles, takes the top hit's pageimage thumbnail.
 * `city` (trip destination) nudges the search toward the right property.
 * Returns the thumbnail URL, or null when there is no article photo.
 */
export async function fetchHotelWikipediaImage(
  name: string,
  city?: string,
  timeoutMs = 4000
): Promise<string | null> {
  const key = `${name.trim().toLowerCase()}|${(city ?? "").trim().toLowerCase()}`;
  if (memCache.has(key)) return memCache.get(key)!;
  const stored = typeof window !== "undefined" ? lsGet(key) : undefined;
  if (stored !== undefined) {
    memCache.set(key, stored);
    return stored;
  }

  let url: string | null = null;
  try {
    const api = new URL("https://en.wikipedia.org/w/api.php");
    api.searchParams.set("action", "query");
    api.searchParams.set("generator", "search");
    api.searchParams.set("gsrsearch", city ? `${name} ${city}` : name);
    api.searchParams.set("gsrlimit", "1");
    api.searchParams.set("gsrnamespace", "0");
    api.searchParams.set("prop", "pageimages");
    api.searchParams.set("piprop", "thumbnail");
    api.searchParams.set("pithumbsize", "320");
    api.searchParams.set("format", "json");
    api.searchParams.set("origin", "*");
    const res = await fetch(api.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = (await res.json()) as WikipediaQueryResponse;
      const pages = data.query?.pages ? Object.values(data.query.pages) : [];
      const thumb = pages[0]?.thumbnail?.source;
      if (typeof thumb === "string" && thumb.startsWith("https://")) url = thumb;
    }
  } catch {
    // offline / timeout - fall through to the pool/monogram
  }

  memCache.set(key, url);
  if (typeof window !== "undefined") lsSet(key, url);
  return url;
}

/**
 * Synchronous deterministic pool pick for the 'lodging' category - a stable
 * hash of the hotel name keeps the same photo across renders. Currently the
 * shared lib has no lodging pool (returns null) → monogram; when one lands,
 * this starts returning real photos with no change here.
 */
export function hotelImagePoolPick(name: string): string | null {
  return placeImageFor({ tags: ["lodging", "hotel"], id: `hotel:${name}` });
}

/**
 * Full chain: Wikipedia photo → deterministic lodging pool → null (monogram).
 */
export async function resolveHotelImage(
  name: string,
  city?: string
): Promise<string | null> {
  const wiki = await fetchHotelWikipediaImage(name, city);
  if (wiki) return wiki;
  return hotelImagePoolPick(name);
}
