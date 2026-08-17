/**
 * Client-side reverse geocoding (Photon, one call per invocation) used to
 * prefill city/country when users save places from the map. Every helper
 * fails soft - callers always have a trip-destination fallback.
 */

export interface GeoPlace {
  city: string;
  country: string;
}

interface PhotonReverseProperties {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  district?: string;
  state?: string;
  country?: string;
}

interface PhotonReverseResponse {
  features?: { properties?: PhotonReverseProperties }[];
}

/** ONE Photon reverse call, `timeoutMs` budget; null on any failure. */
export async function reverseGeocode(
  lat: number,
  lng: number,
  timeoutMs = 3000
): Promise<GeoPlace | null> {
  try {
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = (await res.json()) as PhotonReverseResponse;
    const p = data.features?.[0]?.properties;
    if (!p) return null;
    const city =
      p.city ?? p.town ?? p.village ?? p.municipality ?? p.district ?? "";
    const country = p.country ?? "";
    if (!city && !country) return null;
    return { city, country };
  } catch {
    return null;
  }
}

/** "Kyoto, Japan" → { city: "Kyoto", country: "Japan" } (graceful fallback). */
export function splitDestination(destination: string): GeoPlace {
  const parts = destination
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return { city: parts[0] ?? "", country: parts.slice(1).join(", ") };
}

/** Reverse geocode with a destination-string fallback - never returns empty. */
export async function geoPlaceFor(
  lat: number,
  lng: number,
  destination: string
): Promise<GeoPlace> {
  const geo = await reverseGeocode(lat, lng);
  if (geo) return geo;
  return splitDestination(destination);
}

/* ── Forward place search (hotel/POI autocomplete) ────────────────────────── */

export interface PlaceSearchHit {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface PhotonSearchProperties {
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  city?: string;
  town?: string;
  village?: string;
  country?: string;
}

interface PhotonSearchResponse {
  features?: {
    properties?: PhotonSearchProperties;
    geometry?: { coordinates?: [number, number] };
  }[];
}

/**
 * ONE Photon forward-search call (place autocomplete), optionally biased
 * toward `near`. Fails soft - returns [] on any network/parse failure.
 */
export async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number },
  limit = 6,
  timeoutMs = 4000
): Promise<PlaceSearchHit[]> {
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    if (near) {
      url.searchParams.set("lat", String(near.lat));
      url.searchParams.set("lon", String(near.lng));
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const data = (await res.json()) as PhotonSearchResponse;
    const hits: PlaceSearchHit[] = [];
    for (const f of data.features ?? []) {
      const p = f.properties ?? {};
      const name = (p.name ?? "").trim();
      const [lng, lat] = f.geometry?.coordinates ?? [];
      if (!name || typeof lat !== "number" || typeof lng !== "number") continue;
      const address = [
        p.street
          ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}`
          : (p.district ?? ""),
        p.city ?? p.town ?? p.village ?? "",
        p.country ?? "",
      ]
        .filter(Boolean)
        .join(", ");
      hits.push({ name, address, lat, lng });
    }
    return hits;
  } catch {
    return [];
  }
}

/* ── Global city search (r24-core, feature E) ─────────────────────────────── */

export interface CityHit {
  city: string;
  country: string;
  lat: number;
  lng: number;
}

/**
 * ONE Photon forward-search call restricted to cities/towns/villages - the
 * global city picker for multi-country trips and the wizard "From" field.
 * Fails soft: [] on any network/parse failure.
 */
export async function searchCities(
  query: string,
  limit = 6,
  timeoutMs = 4000
): Promise<CityHit[]> {
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.append("osm_tag", "place:city");
    url.searchParams.append("osm_tag", "place:town");
    url.searchParams.append("osm_tag", "place:village");
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const data = (await res.json()) as PhotonSearchResponse;
    const hits: CityHit[] = [];
    const seen = new Set<string>();
    for (const f of data.features ?? []) {
      const p = f.properties ?? {};
      const city = (p.name ?? p.city ?? p.town ?? p.village ?? "").trim();
      const country = (p.country ?? "").trim();
      const [lng, lat] = f.geometry?.coordinates ?? [];
      if (!city || typeof lat !== "number" || typeof lng !== "number") continue;
      const key = `${city.toLowerCase()}|${country.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ city, country, lat, lng });
    }
    return hits;
  } catch {
    return [];
  }
}
