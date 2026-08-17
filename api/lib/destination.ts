import { WORLD_COUNTRIES } from "./world-cities";

/**
 * Best-effort resolution of a free-text trip destination ("Bengaluru",
 * "Lisbon, Portugal") to a known city/country with coordinates. Used to make
 * the shared-trip cover image destination-aware: the client maps
 * country/coords to the right world region and picks from that region's
 * photo pool instead of a global one.
 */

export interface ResolvedDestination {
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

const norm = (s: string) => s.trim().toLowerCase();

let cityIndex: Map<string, { city: string; country: string; lat: number | null; lng: number | null }> | null =
  null;

function index() {
  if (!cityIndex) {
    cityIndex = new Map();
    for (const c of WORLD_COUNTRIES) {
      for (const city of c.cities) {
        const key = norm(city.name);
        // First (highest-population, since capital leads) entry wins.
        if (!cityIndex.has(key)) {
          cityIndex.set(key, { city: city.name, country: c.name, lat: city.lat, lng: city.lng });
        }
      }
    }
  }
  return cityIndex;
}

export function resolveDestination(destination: string | null | undefined): ResolvedDestination | null {
  if (!destination?.trim()) return null;
  const parts = destination.split(",").map((p) => norm(p)).filter(Boolean);
  const cities = index();

  // "City, Country" - country tail pinned, match the city inside it.
  if (parts.length >= 2) {
    const countryName = parts[parts.length - 1]!;
    const country = WORLD_COUNTRIES.find(
      (c) => norm(c.name) === countryName || norm(c.code) === countryName,
    );
    const cityHit = cities.get(parts[0]!);
    if (country && cityHit && norm(cityHit.country) === norm(country.name)) {
      return { city: cityHit.city, country: country.name, lat: cityHit.lat, lng: cityHit.lng };
    }
    if (country) {
      const capital = country.cities[0];
      return {
        city: parts[0]!,
        country: country.name,
        lat: capital?.lat ?? null,
        lng: capital?.lng ?? null,
      };
    }
    if (cityHit) return { city: cityHit.city, country: cityHit.country, lat: cityHit.lat, lng: cityHit.lng };
    return null;
  }

  // Bare name - city first, then country.
  const cityHit = cities.get(parts[0]!);
  if (cityHit) return { city: cityHit.city, country: cityHit.country, lat: cityHit.lat, lng: cityHit.lng };
  const country = WORLD_COUNTRIES.find((c) => norm(c.name) === parts[0] || norm(c.code) === parts[0]);
  if (country) {
    const capital = country.cities[0];
    return { city: null, country: country.name, lat: capital?.lat ?? null, lng: capital?.lng ?? null };
  }
  return null;
}
