/**
 * r34: places BETWEEN the cities of a road trip.
 *
 * Road-trip stops only ever came from corridor cities (`WHERE city = name`),
 * so the viewpoint, waterfall or fort you actually pull over for on the way
 * could never appear. This samples the route line and looks for scenic /
 * historic places within a few km of it, using the (category, lat, lng) index.
 */

/** Polyline points are [lng, lat]. */
export type LngLat = [number, number];

/**
 * Evenly spaced sample points along the route, skipping the first and last
 * `trim` fraction - those stretches are the origin and destination cities,
 * which already get their own stops.
 */
export function samplePoints(polyline: LngLat[], count: number, trim = 0.08): LngLat[] {
  if (polyline.length < 2 || count < 1) return [];
  const start = Math.floor(polyline.length * trim);
  const end = Math.max(start + 1, Math.ceil(polyline.length * (1 - trim)) - 1);
  const span = end - start;
  const out: LngLat[] = [];
  for (let i = 0; i < count; i++) {
    const idx = start + Math.round((span * (i + 0.5)) / count);
    const p = polyline[Math.min(polyline.length - 1, Math.max(0, idx))];
    if (p) out.push(p);
  }
  return out;
}

/** Degrees of latitude / longitude for a radius in km at a latitude. */
export function boxAround(lat: number, lng: number, km: number) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

export function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat);
  const dLng = toR(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const ROADSIDE_CATEGORIES = ["natural", "historic", "adventure"] as const;
