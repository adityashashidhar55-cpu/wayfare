/**
 * map-links.ts (r24-smart, feature I) - pure builders for "Open in maps"
 * deep links and the premium Google Maps embed URL. No I/O; fully tested.
 *
 * Free for everyone: Google Maps / Apple Maps / OpenStreetMap deep links for
 * a single place or a day's route. Premium: the Google Maps Embed API iframe
 * URL (server adds the key; counted against api_usage).
 */

export interface MapPoint {
  name: string;
  lat?: number | null;
  lng?: number | null;
}

/** "lat,lng" when geocoded (most precise), else the URL-encoded name. */
function queryFor(p: MapPoint): string {
  if (p.lat != null && p.lng != null) return `${p.lat},${p.lng}`;
  return p.name.trim();
}

/** Google Maps search link for one place. */
export function googlePlaceLink(p: MapPoint): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryFor(p))}`;
}

/** Apple Maps link for one place (ll= pins the coordinate when known). */
export function applePlaceLink(p: MapPoint): string {
  const q = encodeURIComponent(p.name.trim());
  if (p.lat != null && p.lng != null) {
    return `https://maps.apple.com/?q=${q}&ll=${p.lat},${p.lng}`;
  }
  return `https://maps.apple.com/?q=${q}`;
}

/** OpenStreetMap link for one place (marker when geocoded, search otherwise). */
export function osmPlaceLink(p: MapPoint): string {
  if (p.lat != null && p.lng != null) {
    return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`;
  }
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(p.name.trim())}`;
}

/** Google Maps directions link for a day's ordered stops (origin + waypoints + destination). */
export function googleRouteLink(stops: MapPoint[]): string | null {
  if (stops.length < 2) return stops.length === 1 ? googlePlaceLink(stops[0]!) : null;
  const [first, ...rest] = stops;
  const last = rest.pop()!;
  const mid = rest.map(queryFor).join("|");
  let url =
    `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(queryFor(first))}` +
    `&destination=${encodeURIComponent(queryFor(last))}&travelmode=walking`;
  if (mid) url += `&waypoints=${encodeURIComponent(mid)}`;
  return url;
}

/** Apple Maps directions link (chained daddr is the documented multi-stop form). */
export function appleRouteLink(stops: MapPoint[]): string | null {
  if (stops.length < 2) return stops.length === 1 ? applePlaceLink(stops[0]!) : null;
  const [first, ...rest] = stops;
  const daddr = rest.map((s) => encodeURIComponent(queryFor(s))).join("+to:");
  return `https://maps.apple.com/?saddr=${encodeURIComponent(queryFor(first))}&daddr=${daddr}`;
}

/** OSM route link (from/to; waypoints beyond two are not supported by the URL scheme). */
export function osmRouteLink(stops: MapPoint[]): string | null {
  const geo = stops.filter((s): s is MapPoint & { lat: number; lng: number } => s.lat != null && s.lng != null);
  if (geo.length < 2) return stops.length === 1 ? osmPlaceLink(stops[0]!) : null;
  const first = geo[0]!;
  const last = geo[geo.length - 1]!;
  return `https://www.openstreetmap.org/directions?from=${first.lat}%2C${first.lng}&to=${last.lat}%2C${last.lng}#map=14/${first.lat}/${first.lng}`;
}

export interface MapLinkSet {
  google: string | null;
  apple: string | null;
  osm: string | null;
}

/** All three deep links for one place. */
export function placeLinks(p: MapPoint): MapLinkSet {
  return { google: googlePlaceLink(p), apple: applePlaceLink(p), osm: osmPlaceLink(p) };
}

/** All three route links for a day's stops. */
export function routeLinks(stops: MapPoint[]): MapLinkSet {
  return { google: googleRouteLink(stops), apple: appleRouteLink(stops), osm: osmRouteLink(stops) };
}

/**
 * Google Maps Embed API iframe URL (premium; server-side use - the key never
 * ships to the client bundle). Mode "place" for one point, "directions" for
 * a route. Returns null without a key so callers show the unavailable state.
 */
export function googleEmbedUrl(key: string | null | undefined, stops: MapPoint[]): string | null {
  if (!key) return null;
  if (stops.length === 0) return null;
  if (stops.length === 1) {
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(queryFor(stops[0]!))}`;
  }
  const [first, ...rest] = stops;
  const last = rest.pop()!;
  let url =
    `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}` +
    `&origin=${encodeURIComponent(queryFor(first))}&destination=${encodeURIComponent(queryFor(last))}&mode=walking`;
  const mid = rest.map(queryFor).join("|");
  if (mid) url += `&waypoints=${encodeURIComponent(mid)}`;
  return url;
}
