/**
 * Road-trip planner (r9-roadtrip): intercity/intercountry trips by car or
 * public transport. Given an origin and destination, the planner routes
 * between them (OSRM), discovers the cities along the corridor (Photon
 * reverse geocoding + the explore_places corpus), allocates days per city
 * weighted by how much there is to see, drafts each city's sightseeing stops
 * from the corpus, and records one 'transport' stop per intercity transfer
 * whose notes carry the commute options (car / train / bus) as JSON:
 *
 *   notes = JSON.stringify({ transfer: { fromCity, toCity, km, options, routeTag? } })
 *
 * r10-routes additions:
 *  - Resilient geocoding: common aliases (NYC→New York, Bombay→Mumbai, …),
 *    query variants (raw / "x city" / "x town" / country-biased) and a
 *    Nominatim fallback. The plan only errors when BOTH endpoints fail.
 *  - OSRM failure degrades to a straight-line corridor (flagged estimated),
 *    never an error.
 *  - Villages/hamlets count as valid in-between stops with a gracefully
 *    lowered corpus threshold (a village with 3 real POIs is a waypoint).
 *  - `via` must-visit waypoints: geocoded, projected onto the corridor in
 *    route order, always kept, always allocated ≥ 1 day.
 *  - Popular routes (api/lib/popular-routes): the corridor is matched
 *    against ~30 famous routes; matches surface as `popularRoute` in the
 *    response and as a `routeTag` note on the transfer stops that follow it.
 *
 * Commute data: car legs via OSRM route/v1/driving; transit via the free
 * db.transport.rest API (EU rail+bus, needs a station lookup) with the
 * transitous MOTIS API (worldwide GTFS) as fallback, and honest
 * distance-based estimates when neither covers the corridor. Nothing here
 * throws on external-API failure - every helper degrades to estimates.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { geocodeCity, geocodeCityInCountry, importCityPlaces, titleCase } from "./queries/overpass";
import { legFollowsRoute, matchPopularRoute } from "./lib/popular-routes";
import { fetchJson } from "./lib/http";
import { isStatueLike, profileStyles, styleMatchScore, STATUE_PENALTY } from "./lib/style-map";
import { isParkingLikeName } from "./lib/place-quality"; // r15-places

// ── Shared types ─────────────────────────────────────────────────────────────
export type CommuteKind = "car" | "train" | "bus";

export interface CommuteOption {
  kind: CommuteKind;
  label: string;
  durationMin: number;
  km: number;
  transfers?: number;
  /** true when derived from distance heuristics instead of a live API. */
  estimated: boolean;
}

// r12-routeui: first line of the trip-notes row that carries planner caveats
// (see the insert after trip creation). The workspace banner parses notes
// that start with this header; keep it in sync with
// src/components/roadtrip/RouteWarningsBanner.tsx.
export const ROUTE_CAVEATS_HEADER = "Route planner heads-up:";

export interface TransferInfo {
  fromCity: string;
  toCity: string;
  km: number;
  options: CommuteOption[];
  /** Famous-route name when this leg follows a matched popular route. */
  routeTag?: string;
}

type LatLng = { lat: number; lng: number };

const UA_STRING = "Wayfare/1.0 (travel app; road-trip planner)";

// ── Geo math ─────────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Resilient geocoding ──────────────────────────────────────────────────────
/**
 * Common aliases / former names / misspellings that raw Photon queries miss
 * ("NYC", "Bombay", "Ladakh", "Swiss Alps", …). Keys are normalized
 * (lowercase, trimmed); values are the canonical query to try FIRST.
 */
const GEO_ALIASES: Record<string, string> = {
  nyc: "New York",
  "new york city": "New York",
  la: "Los Angeles",
  sf: "San Francisco",
  vegas: "Las Vegas",
  dc: "Washington",
  "washington dc": "Washington",
  philly: "Philadelphia",
  bombay: "Mumbai",
  madras: "Chennai",
  calcutta: "Kolkata",
  bangalore: "Bengaluru",
  cochin: "Kochi",
  trivandrum: "Thiruvananthapuram",
  pondicherry: "Puducherry",
  peking: "Beijing",
  saigon: "Ho Chi Minh City",
  rangoon: "Yangon",
  ladakh: "Leh",
  "swiss alps": "Interlaken",
  tuscany: "Florence",
  "amalfi coast": "Amalfi",
  cdmx: "Mexico City",
  kl: "Kuala Lumpur",
  hk: "Hong Kong",
  "sao paolo": "São Paulo",
  tokio: "Tokyo",
  dehli: "Delhi",
  "new dehli": "New Delhi",
  kathmandhu: "Kathmandu",
  dxb: "Dubai",
};

interface GeoPoint {
  lat: number;
  lng: number;
  country: string;
}

/** Nominatim search fallback (OSM's own geocoder) - single best hit. */
async function nominatimSearch(q: string): Promise<GeoPoint | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", q);
    const data = await fetchJson<
      {
        lat?: string;
        lon?: string;
        display_name?: string;
        address?: { country?: string };
      }[]
    >(url, {
      userAgent: UA_STRING, // Nominatim usage policy requires a real User-Agent
      timeoutMs: 6000,
      service: "nominatim",
    });
    const hit = data[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const country = hit.address?.country ?? hit.display_name?.split(",").pop()?.trim() ?? "";
    return { lat, lng, country };
  } catch {
    return null;
  }
}

/**
 * Geocode a free-text place, hard. Order: alias-canonicalized query, then the
 * raw text, then variants ("x, <biasCountry>", "x city", "x town") through
 * Photon; if Photon finds nothing at all, Nominatim search on the most
 * promising variants. `biasCountry` (usually the other endpoint's country)
 * steers ambiguous small places toward the right region. Never throws.
 */
async function geocodeRobust(text: string, biasCountry = ""): Promise<GeoPoint | null> {
  const raw = text.trim();
  if (!raw) return null;
  const alias = GEO_ALIASES[norm(raw)];
  const bases = alias && alias !== raw ? [alias, raw] : [raw];
  const variants: string[] = [];
  for (const b of bases) {
    // Biased variant FIRST when a country steer is given - bare "Goa" ranks
    // Goa, Philippines above Goa, India on Photon, so the unbiased query
    // must not get the first crack when we know the right country.
    if (biasCountry) variants.push(`${b}, ${biasCountry}`);
    variants.push(b);
    variants.push(`${b} city`, `${b} town`);
  }
  for (const q of variants) {
    const hit = await geocodeCity(q);
    if (hit) return hit;
  }
  // Nominatim fallback - alias/canonical first, then the biased variant.
  const fallbackVariants = variants.slice(0, biasCountry ? 4 : 2);
  for (const q of fallbackVariants) {
    const hit = await nominatimSearch(q);
    if (hit) return hit;
  }
  return null;
}

// ── OSRM ─────────────────────────────────────────────────────────────────────
interface OsrmRoute {
  km: number;
  durationMin: number;
  /** [lng, lat] pairs when overview=full was requested. */
  geometry: [number, number][];
}

/**
 * Drive a route through an ordered list of points.
 *
 * r29: `via` waypoints used to be ignored entirely. This function took only
 * from/to and was called with just the two anchors, so a trip explicitly
 * routed "Bengaluru -> Hampi -> Goa" was planned along the Bengaluru->Goa
 * geometry and Hampi was merely PROJECTED onto that line - accepted even when
 * it sat up to 500km off it. The corridor was therefore the wrong corridor,
 * and every leg distance and drive time derived from it was wrong too.
 *
 * OSRM takes an arbitrary number of ;-separated coordinates, so honouring the
 * waypoints is just passing them through. Capped at 8 points (origin + 6 vias
 * + destination) to stay inside the public demo server's URL and CPU limits.
 */
async function osrmRouteVia(
  points: LatLng[],
  overview: "false" | "full" = "false",
): Promise<OsrmRoute | null> {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 8);
  if (pts.length < 2) return null;
  try {
    const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${coords}?overview=${overview}&geometries=geojson`;
    const data = await fetchJson<{
      code?: string;
      routes?: {
        duration?: number;
        distance?: number;
        geometry?: { coordinates?: [number, number][] };
      }[];
    }>(url, { userAgent: UA_STRING, timeoutMs: 15000, service: "osrm" });
    if (data.code !== "Ok" || !data.routes?.[0]) return null;
    const r = data.routes[0];
    if (typeof r.distance !== "number" || typeof r.duration !== "number") return null;
    return {
      km: r.distance / 1000,
      durationMin: r.duration / 60,
      geometry: overview === "full" ? (r.geometry?.coordinates ?? []) : [],
    };
  } catch {
    return null;
  }
}

async function osrmRoute(
  from: LatLng,
  to: LatLng,
  overview: "false" | "full" = "false",
): Promise<OsrmRoute | null> {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}?overview=${overview}&geometries=geojson`;
    const data = await fetchJson<{
      code?: string;
      routes?: {
        duration?: number;
        distance?: number;
        geometry?: { coordinates?: [number, number][] };
      }[];
    }>(url, { userAgent: UA_STRING, timeoutMs: 12000, service: "osrm" });
    if (data.code !== "Ok" || !data.routes?.[0]) return null;
    const r = data.routes[0];
    if (typeof r.distance !== "number" || typeof r.duration !== "number") return null;
    return {
      km: r.distance / 1000,
      durationMin: r.duration / 60,
      geometry: overview === "full" ? (r.geometry?.coordinates ?? []) : [],
    };
  } catch {
    return null;
  }
}

// ── Transit: db.transport.rest (EU rail + bus) ───────────────────────────────
const DBT = "https://v6.db.transport.rest";

interface DbLocation {
  id?: string;
  name?: string;
}

/** Stop/station id for a free-text place name, or null when uncovered. */
async function dbStopId(query: string): Promise<{ id: string; name: string } | null> {
  try {
    const url = `${DBT}/locations?query=${encodeURIComponent(query)}&results=1`;
    const data = await fetchJson<DbLocation[] | Record<string, never>>(url, {
      userAgent: UA_STRING,
      timeoutMs: 6000,
      service: "db.transport.rest",
    });
    const first = Array.isArray(data) ? data[0] : null;
    return first?.id ? { id: String(first.id), name: first.name ?? query } : null;
  } catch {
    return null;
  }
}

interface DbJourney {
  legs?: {
    mode?: string;
    line?: { name?: string; product?: string; operator?: { name?: string } };
    origin?: { name?: string };
    destination?: { name?: string };
  }[];
}

/** db.transport.rest journeys between two station ids → normalized options. */
async function dbTransitOptions(
  fromName: string,
  toName: string,
  km: number,
): Promise<CommuteOption[] | null> {
  try {
    const [fromStop, toStop] = await Promise.all([dbStopId(fromName), dbStopId(toName)]);
    if (!fromStop || !toStop) return null;
    const url =
      `${DBT}/journeys?from=${encodeURIComponent(fromStop.id)}` +
      `&to=${encodeURIComponent(toStop.id)}&results=3`;
    const data = await fetchJson<{ journeys?: DbJourney[] }>(url, {
      userAgent: UA_STRING,
      timeoutMs: 10000,
      service: "db.transport.rest",
    });
    const journeys = data.journeys ?? [];
    const options: CommuteOption[] = [];
    for (const j of journeys.slice(0, 3)) {
      const legs = j.legs ?? [];
      const transitLegs = legs.filter((l) => l.mode !== "walking" && l.line);
      if (!transitLegs.length) continue;
      const dep = (legs[0] as { departure?: string } | undefined)?.departure;
      const arr = (legs[legs.length - 1] as { arrival?: string } | undefined)?.arrival;
      if (!dep || !arr) continue;
      const durationMin = (new Date(arr).getTime() - new Date(dep).getTime()) / 60000;
      if (!(durationMin > 0)) continue;
      const hasRail = transitLegs.some((l) =>
        ["train", "express", "regional"].includes(l.line?.product ?? ""),
      );
      const lineNames = [...new Set(transitLegs.map((l) => l.line?.name).filter(Boolean))] as string[];
      options.push({
        kind: hasRail ? "train" : "bus",
        label: lineNames.slice(0, 2).join(" + ") || (hasRail ? "Train" : "Bus"),
        durationMin: Math.round(durationMin),
        km: Math.round(km),
        transfers: Math.max(0, transitLegs.length - 1),
        estimated: false,
      });
    }
    return options.length ? options : null;
  } catch {
    return null;
  }
}

// ── Transit: transitous (worldwide MOTIS / GTFS) ─────────────────────────────
const TRANSITOUS = "https://api.transitous.org";

interface MotisLeg {
  mode?: string;
  routeShortName?: string;
  routeLongName?: string;
  agencyName?: string;
  duration?: number; // seconds
  from?: { name?: string };
  to?: { name?: string };
}

interface MotisItinerary {
  duration?: number; // seconds
  transfers?: number;
  legs?: MotisLeg[];
}

const RAIL_MODES = new Set([
  "HIGHSPEED_RAIL",
  "LONG_DISTANCE",
  "REGIONAL_RAIL",
  "NIGHT_RAIL",
  "METRO",
  "SUBWAY",
  "TRAM",
]);
const BUS_MODES = new Set(["BUS", "COACH"]);

/**
 * One transitous plan call. Retried once inside the loaded timetable window
 * when the API rejects our departure time (the window shifts as GTFS feeds
 * refresh). Returns null on any failure.
 */
async function transitousPlan(from: LatLng, to: LatLng): Promise<MotisItinerary[] | null> {
  const attempt = async (isoTime: string): Promise<MotisItinerary[] | null> => {
    const url =
      `${TRANSITOUS}/api/v1/plan?fromPlace=${from.lat},${from.lng}` +
      `&toPlace=${to.lat},${to.lng}&time=${encodeURIComponent(isoTime)}&arriveBy=false`;
    const data = await fetchJson<{ itineraries?: MotisItinerary[]; error?: string }>(url, {
      userAgent: UA_STRING,
      timeoutMs: 20000,
      service: "transitous",
    });
    if (Array.isArray(data.itineraries)) return data.itineraries;
    // Outside the loaded timetable window → retry just inside it.
    const m = data.error?.match(/timetable window \[(\d{4}-\d{2}-\d{2})/);
    if (m) {
      const retry = new Date(m[1] + "T00:00:00Z");
      retry.setUTCDate(retry.getUTCDate() + 2);
      retry.setUTCHours(9, 0, 0, 0);
      return attempt(retry.toISOString());
    }
    return null;
  };
  try {
    const depart = new Date(Date.now() + 5 * 86400_000);
    depart.setUTCHours(9, 0, 0, 0);
    return await attempt(depart.toISOString());
  } catch {
    return null;
  }
}

/** Normalize transitous itineraries → up to 3 options (train / bus classified). */
function transitousOptions(its: MotisItinerary[], km: number): CommuteOption[] {
  const options: CommuteOption[] = [];
  const seen = new Set<string>();
  for (const it of its) {
    if (typeof it.duration !== "number" || it.duration <= 0) continue;
    const legs = (it.legs ?? []).filter((l) => l.mode && l.mode !== "WALK" && l.mode !== "BIKE");
    if (!legs.length) continue;
    const railLegs = legs.filter((l) => RAIL_MODES.has(l.mode!));
    const busLegs = legs.filter((l) => BUS_MODES.has(l.mode!));
    const kind: CommuteKind = railLegs.length >= busLegs.length ? "train" : "bus";
    // Label from the dominant transit legs (route name, else agency).
    const main = (kind === "train" ? railLegs : busLegs).length
      ? kind === "train"
        ? railLegs
        : busLegs
      : legs;
    const names = [
      ...new Set(
        main.map((l) => (l.routeShortName ?? l.routeLongName ?? l.agencyName ?? "").trim()),
      ),
    ].filter(Boolean);
    const label = names.slice(0, 2).join(" + ") || (kind === "train" ? "Train" : "Bus");
    const durationMin = Math.round(it.duration! / 60);
    const transfers = typeof it.transfers === "number" ? it.transfers : Math.max(0, legs.length - 1);
    const sig = `${kind}:${label}:${Math.round(durationMin / 15)}`;
    if (seen.has(sig)) continue; // collapse near-duplicate departures
    seen.add(sig);
    options.push({
      kind,
      label,
      durationMin,
      km: Math.round(km),
      transfers,
      estimated: false,
    });
    if (options.length >= 3) break;
  }
  return options;
}

/**
 * Sanity filter for live transit itineraries: open GTFS aggregators have
 * uneven coverage (e.g. transitous lacks JR West rapid services, so MOTIS
 * "routes" Kyoto→Osaka via a 33-hour cross-country bus). Any option far
 * slower than driving the same leg is coverage junk, not a real choice -
 * drop it so callers fall back to honest estimates.
 */
function plausibleTransit(options: CommuteOption[], carMin: number, km: number): CommuteOption[] {
  // Generous ceiling: transit may be up to ~4× the drive (or ~20 km/h avg).
  const ceiling = Math.max(carMin * 4, (km / 55) * 60 * 3 + 45);
  return options.filter((o) => o.durationMin <= ceiling && o.durationMin > 0);
}

// ── Estimates (no live coverage) ─────────────────────────────────────────────
function estimatedTransitOptions(km: number): CommuteOption[] {
  return [
    {
      kind: "train",
      label: "Train (est.)",
      durationMin: Math.round((km / 90) * 60 + 25),
      km: Math.round(km),
      estimated: true,
    },
    {
      kind: "bus",
      label: "Bus (est.)",
      durationMin: Math.round((km / 55) * 60 + 15),
      km: Math.round(km),
      estimated: true,
    },
  ];
}

/**
 * Commute options between two points. mode='car' → OSRM driving only;
 * mode='transit' → live transit options (db.transport.rest → transitous)
 * plus the driving option for comparison; corridors with no transit coverage
 * fall back to honest distance-based estimates (estimated: true). Never throws.
 */
export async function computeCommuteOptions(
  from: LatLng,
  to: LatLng,
  mode: "car" | "transit",
  fromName = "",
  toName = "",
): Promise<{ options: CommuteOption[] }> {
  try {
    const road = await osrmRoute(from, to);
    const airKm = haversineKm(from.lat, from.lng, to.lat, to.lng);
    const km = road?.km ?? airKm * 1.25; // road ≈ 1.25× straight line
    const carOption: CommuteOption = road
      ? {
          kind: "car",
          label: "Drive",
          durationMin: Math.round(road.durationMin),
          km: Math.round(road.km),
          estimated: false,
        }
      : {
          kind: "car",
          label: "Drive (est.)",
          durationMin: Math.round((km / 42) * 60),
          km: Math.round(km),
          estimated: true,
        };
    if (mode === "car") return { options: [carOption] };

    const carMin = carOption.durationMin;
    // 1) db.transport.rest (EU rail/bus, station lookup first)
    if (fromName && toName) {
      const dbOptions = await dbTransitOptions(fromName, toName, km);
      const sane = dbOptions ? plausibleTransit(dbOptions, carMin, km) : [];
      if (sane.length) return { options: [...sane, carOption] };
    }
    // 2) transitous (worldwide GTFS)
    const plan = await transitousPlan(from, to);
    const tOptions = plan?.length ? plausibleTransit(transitousOptions(plan, km), carMin, km) : [];
    if (tOptions.length) return { options: [...tOptions, carOption] };
    // 3) honest estimates
    return { options: [...estimatedTransitOptions(km), carOption] };
  } catch {
    const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
    return {
      options: [
        ...estimatedTransitOptions(km),
        {
          kind: "car",
          label: "Drive (est.)",
          durationMin: Math.round((km / 42) * 60),
          km: Math.round(km),
          estimated: true,
        },
      ],
    };
  }
}

// ── Corridor city discovery ──────────────────────────────────────────────────
interface CorpusCity {
  city: string;
  country: string;
  count: number;
  lat: number;
  lng: number;
}

interface CorridorCity {
  name: string;
  country: string;
  lat: number;
  lng: number;
  corpusCount: number;
  /** Route-progress metric: index of nearest polyline sample point. */
  progress: number;
  isEndpoint: boolean;
  /** User-chosen must-visit waypoint - always kept, always gets ≥ 1 day. */
  isVia: boolean;
  /** Settlement-size rank (city 4 … village 2, hamlet 1.5) - tie-break. */
  kind: number;
  /** OSM population when known (settlement-node discovery) - selection prior. */
  population: number;
}

/** City centroids + place counts for every city in the explore corpus. */
async function corpusCities(): Promise<CorpusCity[]> {
  const rows = await getDb()
    .select({
      city: schema.explorePlaces.city,
      country: schema.explorePlaces.country,
      count: sql<number>`count(*)`,
      lat: sql<number>`avg(${schema.explorePlaces.lat})`,
      lng: sql<number>`avg(${schema.explorePlaces.lng})`,
    })
    .from(schema.explorePlaces)
    .groupBy(schema.explorePlaces.city, schema.explorePlaces.country);
  return rows.map((r) => ({
    city: r.city,
    country: r.country,
    count: Number(r.count),
    lat: Number(r.lat),
    lng: Number(r.lng),
  }));
}

const norm = (s: string) => s.trim().toLowerCase();

/** Settlement-size rank from Photon osm_value (city > town > village > hamlet > …). */
function settlementKind(osmValue: string | undefined): number {
  switch (osmValue) {
    case "city":
      return 4;
    case "town":
    case "municipality":
    case "borough":
      return 3;
    case "village":
      return 2;
    case "hamlet":
    case "isolated_dwelling":
      return 1.5;
    case "district":
    case "suburb":
    case "quarter":
    case "neighbourhood":
      return 1;
    default:
      return 0;
  }
}

/**
 * Photon reverse geocode that scans the first few features and prefers real
 * settlements (city/town/village) over wards/districts/prefectures - the
 * nearest feature is often a subdivision (e.g. "広島県" state over Hiroshima
 * city). Returns the settlement name + a size rank used as a tie-break when
 * two candidate cities both lack a sights corpus.
 */
export async function reverseCity(
  lat: number,
  lng: number,
): Promise<{ city: string; country: string; kind: number } | null> {
  try {
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("limit", "6");
    url.searchParams.set("lang", "en");
    const data = await fetchJson<PhotonReverseResponse>(url, {
      timeoutMs: 4000,
      userAgent: UA_STRING,
      service: "photon",
    });
    const features = (data.features ?? []).slice(0, 6);
    let best: { city: string; country: string; kind: number } | null = null;
    for (const f of features) {
      const p = f.properties ?? {};
      const kind = settlementKind(p.osm_value);
      // Settlement features carry their own name in `name` (the dedicated
      // city/town fields are often empty in JP); address-level features fall
      // back to their enclosing city/district/state fields.
      const name =
        p.city ??
        p.town ??
        p.village ??
        p.municipality ??
        (kind > 0 ? p.name : undefined) ??
        p.district ??
        p.state ??
        "";
      if (!name) continue;
      // Prefer higher settlement kinds; within a kind prefer the feature that
      // names an explicit city over a self-named one.
      const score = kind + (p.city || p.town || p.village ? 0.5 : 0);
      if (!best || score > best.kind) {
        best = { city: name, country: p.country ?? "", kind: score };
      }
    }
    return best;
  } catch {
    return null;
  }
}

interface PhotonReverseResponse {
  features?: {
    properties?: {
      osm_value?: string;
      name?: string;
      city?: string;
      town?: string;
      village?: string;
      municipality?: string;
      district?: string;
      state?: string;
      country?: string;
    };
  }[];
}

/**
 * Overpass `place=city|town` nodes inside a bbox - the reliable way to find
 * MAJOR settlements along a route (reverse geocoding sparse samples often
 * lands in small neighboring towns and misses the metro, e.g. Nagoya between
 * Kyoto and Tokyo). Returns name (name:en preferred), coords and population.
 */
async function settlementNodes(bbox: {
  s: number;
  w: number;
  n: number;
  e: number;
}): Promise<{ name: string; lat: number; lng: number; population: number; place: string }[]> {
  try {
    // NB: `out center tags` - plain `out tags` omits node coordinates.
    // Equality clauses (not a regex) keep the bbox scan index-friendly;
    // big route bboxes 504 on the busier endpoints otherwise.
    const bb = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
    const q =
      `[out:json][timeout:25];\n(\n  node["place"="city"](${bb});\n  node["place"="town"](${bb});\n);\nout center tags 400;`;
    const endpoints = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ];
    for (let attempt = 0; attempt < endpoints.length + 1; attempt++) {
      const endpoint = endpoints[attempt % endpoints.length]!;
      if (attempt === endpoints.length) {
        await new Promise((r) => setTimeout(r, 1200)); // one paced retry
      }
      try {
        const data = await fetchJson<{
          elements?: {
            lat?: number;
            lon?: number;
            center?: { lat?: number; lon?: number };
            tags?: Record<string, string>;
          }[];
        }>(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(q)}`,
          timeoutMs: 25000,
          userAgent: UA_STRING,
          service: "overpass",
        });
        if (process.env.ROADTRIP_DEBUG) {
          console.error(`[roadtrip] settlementNodes raw elements: ${data.elements?.length ?? "?"}`);
        }
        const out: { name: string; lat: number; lng: number; population: number; place: string }[] = [];
        for (const el of data.elements ?? []) {
          const name = el.tags?.["name:en"] ?? el.tags?.name;
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          if (!name || typeof lat !== "number" || typeof lng !== "number") continue;
          out.push({
            name,
            lat,
            lng,
            population: Number(el.tags?.population ?? 0) || 0,
            place: el.tags?.place ?? "town",
          });
        }
        return out;
      } catch (e) {
        if (process.env.ROADTRIP_DEBUG) {
          console.error(`[roadtrip] settlementNodes endpoint failed: ${e instanceof Error ? e.message : e}`);
        }
        // next endpoint
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Sample points densely along the route polyline (~every 30km), reverse-
 * geocode them into settlement candidates, and merge with corpus cities
 * lying within ~25km of the route. Everything is deduped by name and metro
 * proximity (~12km - the same metro can appear under multiple OSM labels,
 * e.g. "Kyoto" / "京都市"), preferring corpus-canonical names.
 */
interface ViaPoint {
  name: string;
  country: string;
  lat: number;
  lng: number;
}

async function corridorCities(
  polyline: [number, number][],
  origin: LatLng & { name: string; country: string },
  dest: LatLng & { name: string; country: string },
  vias: ViaPoint[] = [],
): Promise<{ cities: CorridorCity[]; viaSkipped: { name: string; reason: string }[] }> {
  const corpus = await corpusCities();
  const pts: LatLng[] =
    polyline.length > 0 ? polyline.map(([lng, lat]) => ({ lat, lng })) : [origin, dest];

  // Downsampled projection scaffold: nearest-vertex distance/index for any
  // point (≤ 800 vertices so long routes stay cheap).
  const stride = Math.max(1, Math.ceil(pts.length / 800));
  const projPts: { p: LatLng; i: number }[] = [];
  for (let i = 0; i < pts.length; i += stride) projPts.push({ p: pts[i]!, i });
  if (pts.length) projPts.push({ p: pts[pts.length - 1]!, i: pts.length - 1 });
  const nearestOnRoute = (c: LatLng): { dist: number; idx: number } => {
    let best = Infinity;
    let bestI = 0;
    for (const { p, i } of projPts) {
      const d = haversineKm(c.lat, c.lng, p.lat, p.lng);
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    return { dist: best, idx: bestI };
  };

  // Route length for sample density.
  let routeKm = 0;
  for (let i = 1; i < projPts.length; i++) {
    routeKm += haversineKm(
      projPts[i - 1]!.p.lat,
      projPts[i - 1]!.p.lng,
      projPts[i]!.p.lat,
      projPts[i]!.p.lng,
    );
  }

  // Dense samples along the polyline (~every 30km, 4–14 points incl. ends) -
  // sparse sampling misses major in-between cities (Nagoya between Kyoto and
  // Tokyo at 9 samples, found at 14).
  const SAMPLES = Math.min(14, Math.max(4, Math.round(routeKm / 30) + 1));
  const sampleIdx = new Set<number>();
  for (let i = 0; i < SAMPLES; i++) {
    sampleIdx.add(Math.round((i * (pts.length - 1)) / (SAMPLES - 1)));
  }
  const samplePts = [...sampleIdx].map((i) => ({ ...pts[i]!, progress: i }));

  const DEBUG = !!process.env.ROADTRIP_DEBUG;
  const cities: CorridorCity[] = [];
  const addCity = (c: Omit<CorridorCity, "progress"> & { progress?: number }, via?: string) => {
    const key = norm(c.name);
    if (!key) return;
    // Exact-name duplicate: fold stats into the existing entry (a settlement
    // node's population, a corpus match's place count) instead of dropping.
    const sameName = cities.find((x) => norm(x.name) === key);
    if (sameName) {
      sameName.population = Math.max(sameName.population, c.population);
      sameName.corpusCount = Math.max(sameName.corpusCount, c.corpusCount);
      sameName.kind = Math.max(sameName.kind, c.kind);
      sameName.isVia = sameName.isVia || c.isVia;
      return;
    }
    if (DEBUG) console.error(`[roadtrip] +candidate "${c.name}" via ${via ?? "?"} (corpus ${c.corpusCount}, kind ${c.kind})`);
    // Metro merge: an existing city within ~12km already represents the area.
    // (Was 22km - that swallowed genuinely distinct neighbors, e.g. Himeji's
    // settlement node merged into 西脇市 18km away and handed it 535k people.)
    // Fuzzy-name fold: "Goa" (directory city at Panaji) vs "Goa, India" (state
    // geocode label ~35km away) are the same destination - merge when one name
    // contains the other within a 60km metro radius.
    const near = cities.find((x) => {
      const d = haversineKm(x.lat, x.lng, c.lat, c.lng);
      if (d <= 12) return true;
      const xk = norm(x.name);
      return d <= 60 && (key.includes(xk) || xk.includes(key));
    });
    if (near) {
      near.population = Math.max(near.population, c.population);
      near.isVia = near.isVia || c.isVia; // via status transfers to the merged entry
      // Identity upgrades (corpus-canonical name for a duplicate entry) never
      // touch ENDPOINTS - the traveler's chosen origin/destination names stay.
      if (!near.isEndpoint && (c.isEndpoint || c.corpusCount > near.corpusCount)) {
        if (c.corpusCount >= near.corpusCount || c.isEndpoint) {
          near.name = c.name;
          near.country = c.country || near.country;
          near.lat = c.lat;
          near.lng = c.lng;
          near.kind = Math.max(near.kind, c.kind);
        }
        near.isEndpoint = near.isEndpoint || c.isEndpoint;
      }
      near.corpusCount = Math.max(near.corpusCount, c.corpusCount);
      return;
    }
    cities.push({ ...c, progress: c.progress ?? nearestOnRoute(c).idx });
  };

  // Endpoints first (always included), then corridor samples.
  addCity({ name: origin.name, country: origin.country, lat: origin.lat, lng: origin.lng, corpusCount: 0, isEndpoint: true, isVia: false, kind: 4, population: 0, progress: 0 });
  addCity({ name: dest.name, country: dest.country, lat: dest.lat, lng: dest.lng, corpusCount: 0, isEndpoint: true, isVia: false, kind: 4, population: 0, progress: Math.max(1, pts.length - 1) });

  // Must-visit waypoints: projected onto the corridor (progress = nearest
  // polyline vertex) and always kept downstream. Ones wildly off the
  // corridor (>500km - likely a geocode fluke on another continent) are
  // skipped with a reason so the caller can surface it.
  const viaSkipped: { name: string; reason: string }[] = [];
  for (const v of vias) {
    const { dist } = nearestOnRoute(v);
    if (dist > 500) {
      viaSkipped.push({ name: v.name, reason: "too far off the corridor" });
      continue;
    }
    addCity({
      name: v.name,
      country: v.country,
      lat: v.lat,
      lng: v.lng,
      corpusCount: 0,
      isEndpoint: false,
      isVia: true,
      kind: 4,
      population: 0,
    }, "via waypoint");
  }

  const reverse = await Promise.all(
    samplePts.map((s) => reverseCity(s.lat, s.lng).then((r) => ({ s, r }))),
  );
  for (const { s, r } of reverse) {
    if (!r?.city) continue;
    // Canonical corpus name when this point sits in a corpus city - pick the
    // NEAREST corpus city, not just any within range (sample at Osaka was
    // being labeled "Nara" 31km away because Nara came first in DB order).
    let hit: CorpusCity | null = null;
    let hitDist = Infinity;
    for (const c of corpus) {
      const d = haversineKm(c.lat, c.lng, s.lat, s.lng);
      if ((d <= 35 || norm(c.city) === norm(r.city)) && d < hitDist) {
        hit = c;
        hitDist = d;
      }
    }
    addCity({
      name: hit?.city ?? r.city,
      country: hit?.country ?? r.country,
      lat: s.lat,
      lng: s.lng,
      corpusCount: hit?.count ?? 0,
      isEndpoint: false,
      isVia: false,
      kind: r.kind,
      population: 0,
      progress: s.progress,
    }, `reverse ${hit ? "corpus:" + hit.city : "photon"}`);
  }

  // Corpus cities on the corridor that reverse geocoding missed - gated by
  // distance to the ROUTE itself (≤20km), not to sparse samples, so nearby
  // but off-route cities (Nara ~25km east of the Osaka→Hiroshima highway)
  // stay out.
  for (const c of corpus) {
    if (cities.some((x) => norm(x.name) === norm(c.city))) continue;
    const { dist } = nearestOnRoute(c);
    if (dist > 20) continue;
    addCity({
      name: c.city,
      country: c.country,
      lat: c.lat,
      lng: c.lng,
      corpusCount: c.count,
      isEndpoint: false,
      isVia: false,
      kind: 3,
      population: 0,
    }, `corpus-route ${dist.toFixed(1)}km`);
  }

  // Settlement nodes (place=city|town) within ~15km of the route - finds the
  // major metros that sparse reverse sampling misses (Nagoya, Himeji, …) and
  // brings population as a significance prior. Name:en preferred, so labels
  // stay canonical English.
  const lngs = pts.map((p) => p.lng);
  const lats = pts.map((p) => p.lat);
  const settlements = await settlementNodes({
    s: Math.min(...lats) - 0.18,
    w: Math.min(...lngs) - 0.18,
    n: Math.max(...lats) + 0.18,
    e: Math.max(...lngs) + 0.18,
  });
  if (DEBUG) console.error(`[roadtrip] settlement nodes in bbox: ${settlements.length}`);
  for (const s of settlements) {
    const { dist } = nearestOnRoute(s);
    if (dist > 15) continue;
    const corpusHit = corpus.find((x) => norm(x.city) === norm(s.name));
    addCity({
      name: corpusHit?.city ?? s.name,
      country: corpusHit?.country ?? "",
      lat: s.lat,
      lng: s.lng,
      corpusCount: corpusHit?.count ?? 0,
      isEndpoint: false,
      isVia: false,
      kind: s.place === "city" ? 4 : 3,
      population: s.population,
    }, `settlement pop ${s.population}`);
  }

  // Backfill corpus counts for endpoint/reverse cities (exact-name match).
  for (const c of cities) {
    if (c.corpusCount > 0) continue;
    const hit = corpus.find((x) => norm(x.city) === norm(c.name));
    if (hit) c.corpusCount = hit.count;
  }

  // Origin → destination order along the route.
  cities.sort((a, b) => a.progress - b.progress || b.corpusCount - a.corpusCount);
  return { cities, viaSkipped };
}

// ── Day allocation ───────────────────────────────────────────────────────────
/**
 * Days per city ∝ sqrt of the sights corpus (a 250-place city clearly
 * out-weighs a 25-place town - log scaling flattened that - but not 10×
 * more). Min 1 day/city, sum = days.
 */
function allocateDays(cities: CorridorCity[], days: number): number[] {
  const weights = cities.map((c) => 0.75 + Math.sqrt(c.corpusCount));
  const base = cities.map(() => 1);
  let remaining = days - cities.length;
  if (remaining <= 0) return base;
  const totalW = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (remaining * w) / totalW);
  const alloc = base.map((b, i) => b + Math.floor(raw[i]!));
  let left = days - alloc.reduce((a, b) => a + b, 0);
  // Largest remainder first; ties → higher weight (bigger sights corpus).
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r), w: weights[i]! }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w);
  for (let k = 0; left > 0 && k < order.length; k++, left--) {
    alloc[order[k]!.i]! += 1;
  }
  return alloc;
}

/**
 * How much corpus a city needs to stay in the plan, scaled by settlement
 * size: a metropolis with <20 places was probably never imported properly,
 * but a village with 3 real POIs is a valid waypoint experience.
 */
function corpusThreshold(c: CorridorCity): number {
  if (c.kind >= 3) return 20; // city / town
  if (c.kind >= 2) return 5; // village
  if (c.kind >= 1.5) return 3; // hamlet
  return 20; // district/unknown - no special treatment
}

// ── Place picking (corpus-ranked, budget-neutral) ────────────────────────────
type PlaceRow = typeof schema.explorePlaces.$inferSelect;

const SLOT_TIMES = ["09:00", "12:30", "15:00", "19:00"];
const SLOT_DURATIONS = [150, 90, 120, 100];
const FOOD_CATEGORIES = new Set(["food", "restaurant", "cafe", "bar"]);

/** Ensure a city has a usable corpus; bulk-import from Overpass when thin.
 *  Country-scoped: same-named cities abroad ("Goa" India vs Philippines)
 *  must not count toward - or trigger imports for - the wrong country. */
async function ensureCityCorpus(city: CorridorCity): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.explorePlaces)
    .where(
      and(
        eq(schema.explorePlaces.city, city.name),
        city.country ? eq(schema.explorePlaces.country, city.country) : undefined,
      ),
    );
  const count = Number(rows[0]?.n ?? 0);
  if (count >= 8) return count;
  try {
    const result = await importCityPlaces(
      city.country ? `${city.name}, ${city.country}` : city.name,
    );
    return result.total;
  } catch {
    return count;
  }
}

/**
 * Reorder a sequentially-consumed pool so statue-like places (memorials,
 * statues, artworks) land at least `gap` picks apart - ≈ ≤1 per day when the
 * generator consumes ~`gap` stops a day. Overflow statues drop to the very
 * end, below every real attraction; relative order is otherwise preserved.
 */
function spreadStatues<T extends { name?: string | null; tags?: string[] | null }>(
  pool: T[],
  gap: number,
): T[] {
  const out: T[] = [];
  const deferred: T[] = [];
  for (const p of pool) {
    if (isStatueLike(p) && out.slice(-(gap - 1)).some((q) => isStatueLike(q))) {
      deferred.push(p);
    } else {
      out.push(p);
    }
  }
  return out.concat(deferred);
}

/**
 * r15-places: a valid MEAL stop - restaurant/café/bar categories only, and
 * never a market that lacks a food signal (produce/wholesale markets are
 * shopping; this guards corpora not yet repaired by db/fix-classification.ts).
 * Parking/rest-area rows never qualify as any stop.
 */
function isMealStop(p: PlaceRow): boolean {
  if (!FOOD_CATEGORIES.has(p.category.toLowerCase())) return false;
  const tags = (p.tags ?? []).map((t) => t.toLowerCase());
  if (tags.includes("market") && !tags.includes("food")) return false;
  return true;
}

/** Top places for a city: style overlap (style-map aware) + rating + hidden-gem
 *  bonus, statues deprioritized and capped ≤1 per day-window, food interleaved.
 *  r15: parking/rest-area rows are excluded from the stop pool entirely, and
 *  food stops come only from meal categories (markets are activity stops). */
async function cityPlaces(city: CorridorCity, limit: number, styles: Set<string>): Promise<PlaceRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.explorePlaces)
    .where(
      and(
        eq(schema.explorePlaces.city, city.name),
        // Country-scope the stop pool: without this, a Mumbai→Goa plan filled
        // its Goa days with places from Goa, Philippines (same city name).
        city.country ? eq(schema.explorePlaces.country, city.country) : undefined,
      ),
    )
    .orderBy(asc(schema.explorePlaces.id));
  const ranked = rows
    .filter((p) => !isParkingLikeName(p.name)) // r15-places
    .map((p) => {
      // Canonical styles-column overlap + tag overlap via the shared style
      // map - a "nightlife"/"music" ask now boosts bars/clubs instead of
      // falling back to rating order (which surfaced statues).
      let score = styleMatchScore(p, styles) + (p.rating ?? 4) * 2 + (p.hidden ? 1.5 : 0);
      if (isStatueLike(p)) score -= STATUE_PENALTY;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.p);
  // Interleave: mostly activities, ~1 food stop per 4. A misfiled produce
  // market (category food, market tag, no food tag) is NEITHER - excluded.
  const acts = ranked.filter((p) => !FOOD_CATEGORIES.has(p.category.toLowerCase()));
  const food = ranked.filter(isMealStop);
  const out: PlaceRow[] = [];
  let ai = 0;
  let fi = 0;
  while (out.length < limit && (ai < acts.length || fi < food.length)) {
    const wantFood = out.length > 0 && out.length % 4 === 3;
    if (wantFood && fi < food.length) out.push(food[fi++]!);
    else if (ai < acts.length) out.push(acts[ai++]!);
    else out.push(food[fi++]!);
  }
  return spreadStatues(out, 4);
}

// ── Router ───────────────────────────────────────────────────────────────────
export const roadtripRouter = createRouter({
  /**
   * Commute options between two coordinates. Car legs come from OSRM;
   * transit tries db.transport.rest (station lookup first) then transitous,
   * and degrades to distance-based estimates where neither has coverage.
   * Never throws.
   */
  commuteOptions: authedQuery
    .input(
      z.object({
        fromLat: z.number().min(-90).max(90),
        fromLng: z.number().min(-180).max(180),
        toLat: z.number().min(-90).max(90),
        toLng: z.number().min(-180).max(180),
        mode: z.enum(["car", "transit"]),
        fromName: z.string().max(255).optional(),
        toName: z.string().max(255).optional(),
      }),
    )
    .query(async ({ input }) => {
      return computeCommuteOptions(
        { lat: input.fromLat, lng: input.fromLng },
        { lat: input.toLat, lng: input.toLng },
        input.mode,
        input.fromName ?? "",
        input.toName ?? "",
      );
    }),

  /**
   * Plan a multi-city road trip: geocode endpoints, route the corridor,
   * discover in-between cities, allocate days by sights weight, draft stops
   * per city, and record one transport stop per intercity transfer.
   */
  /**
   * r29: SEE THE ROUTE BEFORE COMMITTING TO IT.
   *
   * `planRoadtrip` below is a mutation that geocodes, routes, picks cities,
   * allocates days, creates the trip, its days, its stops and a member row,
   * then navigates you into it. There was no way to ask "what would you plan
   * for me?" - the only way to find out was to have it built, look at it, and
   * delete the trip if it was wrong. For a feature whose whole job is
   * answering "what is worth stopping for between A and B", that is the wrong
   * order of operations.
   *
   * This does the discovery half and returns it. Nothing is written.
   *
   * Preferences are read from the saved taste profile when the caller does
   * not override them, which the builder UI never did - it initialised styles
   * to [] and made the user re-pick them in a collapsed "optional" section.
   */
  previewRoute: authedQuery
    .input(
      z.object({
        originText: z.string().min(1).max(255),
        destText: z.string().min(1).max(255),
        via: z.array(z.string().min(1).max(255)).max(5).optional(),
        styles: z.array(z.string()).optional(),
        /** Places per corridor city in the preview. */
        perCity: z.number().int().min(1).max(12).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const warnings: string[] = [];

      let [originGeo, destGeo] = await Promise.all([
        geocodeRobust(input.originText),
        geocodeRobust(input.destText),
      ]);
      if (!originGeo && destGeo?.country) originGeo = await geocodeRobust(input.originText, destGeo.country);
      if (!destGeo && originGeo?.country) destGeo = await geocodeRobust(input.destText, originGeo.country);
      if (!originGeo || !destGeo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not find ${!originGeo ? input.originText : input.destText}. Try adding the country.`,
        });
      }

      const viaGeo: ViaPoint[] = [];
      for (const raw of input.via ?? []) {
        const g = await geocodeRobust(raw, originGeo.country ?? destGeo.country);
        if (g) viaGeo.push({ name: titleCase(raw.split(",")[0]!.trim()), lat: g.lat, lng: g.lng, country: g.country ?? "" });
        else warnings.push(`Could not place "${raw}" - skipped.`);
      }

      const airKm = haversineKm(originGeo.lat, originGeo.lng, destGeo.lat, destGeo.lng);
      const route = await osrmRouteVia(
        [
          { lat: originGeo.lat, lng: originGeo.lng },
          ...viaGeo.map((v) => ({ lat: v.lat, lng: v.lng })),
          { lat: destGeo.lat, lng: destGeo.lng },
        ],
        "full",
      );
      const polyline: [number, number][] =
        route?.geometry.length && route.geometry.length >= 2
          ? route.geometry
          : interpolate([originGeo.lng, originGeo.lat], [destGeo.lng, destGeo.lat],
              Math.min(160, Math.max(32, Math.round(airKm / 25))));

      const origin = { name: titleCase(input.originText.split(",")[0]!.trim()), lat: originGeo.lat, lng: originGeo.lng, country: originGeo.country ?? "" };
      const dest = { name: titleCase(input.destText.split(",")[0]!.trim()), lat: destGeo.lat, lng: destGeo.lng, country: destGeo.country ?? "" };

      const corridor = await corridorCities(polyline, origin, dest, viaGeo);

      // Styles: explicit input wins, else the saved profile. The builder never
      // read the profile, so a user who told us they like food and history in
      // onboarding got a route ranked as if they had said nothing.
      let styles = new Set<string>(input.styles ?? []);
      if (styles.size === 0) {
        const [pref] = await getDb()
          .select()
          .from(schema.preferences)
          .where(eq(schema.preferences.userId, ctx.user.id))
          .limit(1);
        styles = profileStyles(pref);
      }

      const cities = await Promise.all(
        corridor.map(async (city) => ({
          name: city.name,
          country: city.country,
          lat: city.lat,
          lng: city.lng,
          kmFromStart: Math.round(city.alongKm ?? 0),
          places: (await cityPlaces(city, input.perCity, styles)).map((p) => ({
            id: Number(p.id), name: p.name, category: p.category,
            description: p.description, image: p.image,
            qualityScore: (p as { qualityScore?: number }).qualityScore ?? 0,
          })),
        })),
      );

      return {
        origin, dest,
        via: viaGeo.map((v) => ({ name: v.name, lat: v.lat, lng: v.lng })),
        totalKm: Math.round(route?.km ?? airKm),
        driveHours: route ? Math.round((route.durationMin / 60) * 10) / 10 : null,
        routeEstimated: !route,
        polyline,
        cities: cities.filter((c) => c.places.length > 0),
        stylesUsed: [...styles],
        warnings,
      };
    }),

  planRoadtrip: authedQuery
    .input(
      z.object({
        originText: z.string().min(1).max(255),
        destText: z.string().min(1).max(255),
        mode: z.enum(["car", "transit"]),
        days: z.number().int().min(2).max(21),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        /** Must-visit waypoints along the way (0–5 free-text places). */
        via: z.array(z.string().min(1).max(255)).max(5).optional(),
        styles: z.array(z.string()).optional(),
        title: z.string().max(255).optional(),
        homeCurrency: z.string().length(3).default("USD"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const geocodeWarnings: string[] = [];
      const viaSkipped: { name: string; reason: string }[] = [];

      // (a) Geocode both endpoints - aliases + variants + Nominatim fallback,
      // then a cross-biased retry (the successful endpoint's country steers
      // the ambiguous one). Only BOTH failing is a hard error; a single
      // failure degrades to a single-city plan around the placed endpoint.
      let [originGeo, destGeo] = await Promise.all([
        geocodeRobust(input.originText),
        geocodeRobust(input.destText),
      ]);
      if (!originGeo && destGeo?.country) {
        originGeo = await geocodeRobust(input.originText, destGeo.country);
      }
      if (!destGeo && originGeo?.country) {
        destGeo = await geocodeRobust(input.destText, originGeo.country);
      }
      if (!originGeo && !destGeo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "GEOCODE_UNKNOWN" });
      }
      if (!originGeo) {
        geocodeWarnings.push(
          `We couldn't place “${input.originText}”, planned around the destination instead.`,
        );
      }
      if (!destGeo) {
        geocodeWarnings.push(
          `We couldn't place “${input.destText}”, planned around the origin instead.`,
        );
      }
      // (a1) Implausible-corridor guard: if both endpoints geocoded but sit an
      // ocean apart (>3000 km), at least one likely matched a same-named place
      // on the wrong continent (e.g. "Goa" → Goa, Philippines for a Mumbai→Goa
      // trip - Photon ranks the Philippine municipality first). Re-geocode each
      // endpoint biased by the other's country; swap when the biased hit is
      // dramatically closer to its counterpart.
      if (originGeo && destGeo) {
        const gapKm = haversineKm(originGeo.lat, originGeo.lng, destGeo.lat, destGeo.lng);
        if (gapKm > 3000) {
          // Name-validated, country-scoped lookups only - a fuzzy Photon hit
          // in the right country with the wrong name ("Mumbai, Philippines"
          // → Digos) must never justify a swap.
          const [altOrigin, altDest] = await Promise.all([
            geocodeCityInCountry(input.originText, destGeo.country),
            geocodeCityInCountry(input.destText, originGeo.country),
          ]);
          if (altOrigin) {
            const d = haversineKm(altOrigin.lat, altOrigin.lng, destGeo.lat, destGeo.lng);
            if (d < gapKm * 0.5) {
              geocodeWarnings.push(
                `“${input.originText}” first matched a same-named place in ${originGeo.country || "another country"}, used the one in ${altOrigin.country || "the right country"} instead.`,
              );
              originGeo = altOrigin;
            }
          }
          if (altDest) {
            const gapNow = haversineKm(originGeo.lat, originGeo.lng, destGeo.lat, destGeo.lng);
            const d = haversineKm(originGeo.lat, originGeo.lng, altDest.lat, altDest.lng);
            if (d < gapNow * 0.5) {
              geocodeWarnings.push(
                `“${input.destText}” first matched a same-named place in ${destGeo.country || "another country"}, used the one in ${altDest.country || "the right country"} instead.`,
              );
              destGeo = altDest;
            }
          }
        }
      }
      const anchorA = originGeo ?? destGeo!;
      const anchorB = destGeo ?? originGeo!;

      // (a2) Must-visit waypoints: geocode each (biased toward the corridor's
      // country). Unplaceable ones never fail the plan - they're reported.
      let viaGeo: ViaPoint[] = [];
      if (input.via?.length) {
        if (originGeo && destGeo) {
          const bias = originGeo.country || destGeo.country;
          const geocoded = await Promise.all(
            input.via.map(async (v) => ({ v, g: await geocodeRobust(v, bias) })),
          );
          for (const { v, g } of geocoded) {
            const hit = g ?? (await geocodeRobust(v, destGeo.country || originGeo.country));
            if (!hit) {
              viaSkipped.push({ name: v, reason: "we couldn't place it" });
              continue;
            }
            viaGeo.push({
              name: titleCase(v.split(",")[0]!.trim()),
              country: hit.country,
              lat: hit.lat,
              lng: hit.lng,
            });
          }
          // Each via city is guaranteed ≥ 1 day - that only works when the
          // trip has enough days for endpoints + waypoints.
          const viaCapacity = Math.max(0, input.days - 2);
          if (viaGeo.length > viaCapacity) {
            for (const dropped of viaGeo.splice(viaCapacity)) {
              viaSkipped.push({
                name: dropped.name,
                reason: `only ${input.days} days, not enough room for every must-visit`,
              });
            }
          }
        } else {
          for (const v of input.via) {
            viaSkipped.push({ name: v, reason: "must-visit stops need both endpoints placed" });
          }
        }
      }

      // (b) Drive route between them (polyline). OSRM failure/timeout degrades
      // to a straight-line (great-circle) corridor flagged `routeEstimated` -
      // corridor discovery and day allocation work the same either way.
      const airKm = haversineKm(anchorA.lat, anchorA.lng, anchorB.lat, anchorB.lng);
      const singleCity = airKm < 80 && viaGeo.length === 0;
      // r29: route THROUGH the vias. Previously this called osrmRoute with
      // only the two anchors, so "Bengaluru -> Hampi -> Goa" was planned along
      // the direct Bengaluru->Goa line and Hampi was merely projected onto it
      // (accepted up to 500km off-corridor). The corridor, the leg distances
      // and every drive time derived from them were all for a route the user
      // had not asked for.
      const routePoints: LatLng[] = [
        { lat: anchorA.lat, lng: anchorA.lng },
        ...viaGeo.map((v) => ({ lat: v.lat, lng: v.lng })),
        { lat: anchorB.lat, lng: anchorB.lng },
      ];
      const route = singleCity ? null : await osrmRouteVia(routePoints, "full");
      const routeGeometry =
        route?.geometry.length && route.geometry.length >= 2 ? route.geometry : null;
      const routeEstimated = !singleCity && !routeGeometry;
      const polyline: [number, number][] =
        routeGeometry ??
        interpolate(
          [anchorA.lng, anchorA.lat],
          [anchorB.lng, anchorB.lat],
          Math.min(160, Math.max(32, Math.round(airKm / 25))),
        );

      // Endpoint display names: settlement-aware reverse geocode, else input.
      const [originRev, destRev] = await Promise.all([
        reverseCity(anchorA.lat, anchorA.lng),
        reverseCity(anchorB.lat, anchorB.lng),
      ]);
      const origin = {
        name: originRev?.city ?? titleCase(input.originText.split(",")[0]!.trim()),
        country: originRev?.country ?? anchorA.country,
        lat: anchorA.lat,
        lng: anchorA.lng,
      };
      const dest = {
        name: destRev?.city ?? titleCase(input.destText.split(",")[0]!.trim()),
        country: destRev?.country ?? anchorB.country,
        lat: anchorB.lat,
        lng: anchorB.lng,
      };

      // (b2) Famous routes: does this corridor follow a curated popular one?
      const popular = singleCity ? null : matchPopularRoute(polyline, origin, dest);

      // (c) Corridor cities along the polyline (+ corpus matcher + vias).
      let cities: CorridorCity[];
      if (singleCity) {
        cities = [
          {
            name: origin.name,
            country: origin.country,
            lat: origin.lat,
            lng: origin.lng,
            corpusCount: 0,
            progress: 0,
            isEndpoint: true,
            isVia: false,
            kind: 4,
            population: 0,
          },
        ];
      } else {
        const corridor = await corridorCities(polyline, origin, dest, viaGeo);
        cities = corridor.cities;
        viaSkipped.push(...corridor.viaSkipped);
      }

      // Cap candidates BEFORE any Overpass import (imports are bounded to the
      // cities that actually make the plan): endpoints always stay, in-between
      // cities rank by significance - population is the strongest unbiased
      // proxy (a 2M metro beats a 15k town with a fat imported corpus), the
      // known sights corpus counts at ~2k people per place. Roughly one city
      // per two travel days keeps the plan breathable.
      const maxCities = Math.min(Math.max(2, Math.ceil(input.days / 2) + 1), 8);
      if (process.env.ROADTRIP_DEBUG) {
        console.error(
          `[roadtrip] candidates before cap (${cities.length}, max ${maxCities}): ` +
            cities
              .map((c) => `${c.name}[ep:${c.isEndpoint ? 1 : 0} via:${c.isVia ? 1 : 0} pop:${c.population} corpus:${c.corpusCount} prog:${c.progress}]`)
              .join(" "),
        );
      }
      if (cities.length > maxCities) {
        // In-between cities within ~35km of an endpoint are metro satellites
        // (Kobe to Osaka) - discount them so stops spread along the route.
        const mustPts = cities.filter((c) => c.isEndpoint || c.isVia);
        const significance = (c: CorridorCity) => {
          const raw = c.population + c.corpusCount * 2000;
          const nearEndpoint = mustPts.some(
            (e) => haversineKm(e.lat, e.lng, c.lat, c.lng) <= 35,
          );
          return nearEndpoint ? raw * 0.35 : raw;
        };
        const rest = cities
          .filter((c) => !c.isEndpoint && !c.isVia)
          .sort((a, b) => significance(b) - significance(a) || b.kind - a.kind)
          .slice(0, Math.max(0, maxCities - mustPts.length));
        cities = [...mustPts, ...rest].sort((a, b) => a.progress - b.progress);
      }

      // (d) Day allocation weighted by sights corpus. Thin cities (<8 places)
      // are bulk-imported via Overpass first (cap 6 imports, must-visit stops
      // first); after counting, in-between cities that still have a
      // near-empty corpus drop out of the plan. The threshold scales with
      // settlement size - a village with 3 real POIs is a valid waypoint
      // experience, a hamlet with none is not.
      const importOrder = [...cities].sort(
        (a, b) => Number(b.isEndpoint || b.isVia) - Number(a.isEndpoint || a.isVia),
      );
      let imports = 0;
      for (const c of importOrder) {
        const hit = await corpusCountOf(c.name);
        c.corpusCount = Math.max(c.corpusCount, hit);
        if (c.corpusCount < 8 && imports < 6) {
          imports++;
          c.corpusCount = await ensureCityCorpus(c);
        }
      }
      if (!singleCity) {
        const significant = cities.filter(
          (c) => c.isEndpoint || c.isVia || c.corpusCount >= corpusThreshold(c),
        );
        if (significant.length >= 2) cities = significant;
      }
      // Belt-and-braces: every kept city gets ≥ 1 day, so the plan can never
      // hold more cities than days (must-includes win, then significance).
      if (cities.length > input.days) {
        const must = cities.filter((c) => c.isEndpoint || c.isVia);
        const rest = cities
          .filter((c) => !c.isEndpoint && !c.isVia)
          .sort(
            (a, b) =>
              b.population + b.corpusCount * 2000 - (a.population + a.corpusCount * 2000),
          )
          .slice(0, Math.max(0, input.days - must.length));
        cities = [...must, ...rest].sort((a, b) => a.progress - b.progress);
      }
      const dayAlloc = allocateDays(cities, input.days);

      // (e) Pick top places per city (3–4 per day, style-aware, budget-neutral).
      // r29: fall back to the saved taste profile. RoadtripBuilder initialises
      // styles to [] and hides the picker in a collapsed "optional" section,
      // so in practice this arrived empty and the route was ranked as if the
      // user had told us nothing about themselves - despite onboarding having
      // asked.
      let styles = new Set<string>(input.styles ?? []);
      if (styles.size === 0) {
        const [pref] = await db
          .select()
          .from(schema.preferences)
          .where(eq(schema.preferences.userId, ctx.user.id))
          .limit(1);
        styles = profileStyles(pref);
      }
      const cityPlacePools = await Promise.all(
        cities.map((c, i) => cityPlaces(c, dayAlloc[i]! * 4 + 2, styles)),
      );

      // (f) Create the trip.
      const start = new Date(input.startDate + "T00:00:00Z");
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + input.days - 1);
      const endDate = end.toISOString().slice(0, 10);
      // Canonical endpoint names from the (corpus-matched) city list.
      const firstCity = cities[0]?.name ?? origin.name;
      const lastCity = cities[cities.length - 1]?.name ?? dest.name;
      const title = input.title ?? `${firstCity} → ${lastCity}`;
      const coverImage =
        cityPlacePools.flat().find((p) => p.image)?.image ?? null;

      const tripRes = await db.insert(schema.trips).values({
        ownerId: ctx.user.id,
        title,
        destination: `${lastCity}${(cities[cities.length - 1]?.country ?? dest.country) ? `, ${cities[cities.length - 1]?.country ?? dest.country}` : ""}`,
        coverImage,
        startDate: input.startDate,
        endDate,
        homeCurrency: input.homeCurrency,
        tripType: "roadtrip",
        originName: origin.name,
        originLat: origin.lat,
        originLng: origin.lng,
        intercityMode: input.mode,
      });
      const tripId = Number(tripRes[0].insertId);
      await db.insert(schema.tripMembers).values({
        tripId,
        userId: ctx.user.id,
        name: ctx.user.name ?? "You",
        email: ctx.user.email ?? null,
        role: "owner",
        presenceColor: "#BC5934",
      });

      // r12-routeui: persist planner caveats (geocode corrections, skipped
      // must-visits) as the trip's note so the workspace can surface them in
      // a dismissible banner after redirect. The trips table has no notes
      // column and trip_notes is 1-row-per-trip, so a human-readable list
      // with a stable header line doubles as the parse format - the Notes
      // tab shows the same text and the user can edit/delete it freely.
      const caveatLines = [
        ...geocodeWarnings,
        ...viaSkipped.map((v) => `Skipped “${v.name}”, ${v.reason}.`),
      ];
      if (caveatLines.length) {
        await db.insert(schema.tripNotes).values({
          tripId,
          title: "Route planner notes",
          content: `${ROUTE_CAVEATS_HEADER}\n${caveatLines.map((l) => `- ${l}`).join("\n")}`,
        });
      }

      // Day rows.
      const dayIds: number[] = [];
      for (let d = 0; d < input.days; d++) {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + d);
        const dayRes = await db.insert(schema.tripDays).values({
          tripId,
          date: date.toISOString().slice(0, 10),
          position: d,
          transportMode: input.mode === "car" ? "car" : "transit",
        });
        dayIds.push(Number(dayRes[0].insertId));
      }

      // Stops per city + one transport stop per intercity transfer.
      const transfers: {
        from: string;
        to: string;
        km: number;
        primaryOption: CommuteOption | null;
        routeTag?: string;
      }[] = [];
      let position = 0;
      let dayOffset = 0;
      for (let ci = 0; ci < cities.length; ci++) {
        const city = cities[ci]!;
        const nDays = dayAlloc[ci]!;
        const pool = cityPlacePools[ci]!;
        let poolIdx = 0;
        const isLastCity = ci === cities.length - 1;

        for (let d = 0; d < nDays; d++) {
          const dayId = dayIds[dayOffset + d]!;
          const departureDay = d === nDays - 1 && !isLastCity;
          const citySlots = departureDay ? 3 : 4;
          for (let s = 0; s < citySlots && poolIdx < pool.length; s++, poolIdx++) {
            const place = pool[poolIdx]!;
            await db.insert(schema.stops).values({
              tripId,
              dayId,
              name: place.name,
              category: place.category,
              address: `${place.city}, ${place.country}`,
              lat: place.lat,
              lng: place.lng,
              startTime: SLOT_TIMES[s]!,
              durationMin: SLOT_DURATIONS[s]!,
              notes: place.description,
              image: place.image,
              position: position++,
            });
          }

          // Transport stop on the day you leave the city (19:00 slot).
          if (departureDay) {
            const next = cities[ci + 1]!;
            const commute = await computeCommuteOptions(
              { lat: city.lat, lng: city.lng },
              { lat: next.lat, lng: next.lng },
              input.mode,
              city.name,
              next.name,
            );
            const km =
              commute.options[0]?.km ??
              Math.round(haversineKm(city.lat, city.lng, next.lat, next.lng));
            const primary = commute.options[0] ?? null;
            // Tag legs that follow the matched popular route - the workspace
            // shows a subtle "Golden Route" chip on these transport stops.
            const onPopularRoute =
              popular != null &&
              legFollowsRoute(
                popular,
                { lat: city.lat, lng: city.lng },
                { lat: next.lat, lng: next.lng },
              );
            const transfer: TransferInfo = {
              fromCity: city.name,
              toCity: next.name,
              km,
              options: commute.options,
              ...(onPopularRoute ? { routeTag: popular.route.name } : {}),
            };
            await db.insert(schema.stops).values({
              tripId,
              dayId,
              name: `${city.name} → ${next.name}`,
              category: "transport",
              address: `${next.name}${next.country ? `, ${next.country}` : ""}`,
              lat: next.lat,
              lng: next.lng,
              startTime: SLOT_TIMES[3]!,
              durationMin: primary?.durationMin ?? null,
              notes: JSON.stringify({ transfer }),
              position: position++,
            });
            transfers.push({
              from: city.name,
              to: next.name,
              km,
              primaryOption: primary,
              ...(transfer.routeTag ? { routeTag: transfer.routeTag } : {}),
            });
          }
        }
        dayOffset += nDays;
      }

      return {
        tripId,
        title,
        singleCity,
        cities: cities.map((c, i) => ({ city: c.name, country: c.country, days: dayAlloc[i]!, via: c.isVia })),
        transfers,
        popularRoute: popular
          ? { slug: popular.route.slug, name: popular.route.name, blurb: popular.route.blurb }
          : null,
        routeEstimated,
        geocodeWarnings,
        viaSkipped,
      };
    }),
});

/**
 * Straight-line (great-circle) fallback geometry when OSRM is unreachable -
 * slerp between the two endpoints so long corridors stay realistic.
 * Points are [lng, lat] pairs, matching OSRM geojson coordinates.
 */
function interpolate(a: [number, number], b: [number, number], n: number): [number, number][] {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const toVec = ([lng, lat]: [number, number]) => {
    const la = toRad(lat);
    const lo = toRad(lng);
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  };
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0]! * vb[0]! + va[1]! * vb[1]! + va[2]! * vb[2]!));
  const omega = Math.acos(dot);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x: number;
    let y: number;
    let z: number;
    if (omega < 1e-7) {
      // Endpoints (nearly) identical - plain lerp avoids the 0/0.
      x = va[0]! + (vb[0]! - va[0]!) * t;
      y = va[1]! + (vb[1]! - va[1]!) * t;
      z = va[2]! + (vb[2]! - va[2]!) * t;
    } else {
      const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
      const s2 = Math.sin(t * omega) / Math.sin(omega);
      x = s1 * va[0]! + s2 * vb[0]!;
      y = s1 * va[1]! + s2 * vb[1]!;
      z = s1 * va[2]! + s2 * vb[2]!;
    }
    const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
    const lng = (Math.atan2(y, x) * 180) / Math.PI;
    pts.push([lng, lat]);
  }
  return pts;
}

/** Corpus place count for one city (exact match). */
async function corpusCountOf(city: string): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.city, city));
  return Number(rows[0]?.n ?? 0);
}
