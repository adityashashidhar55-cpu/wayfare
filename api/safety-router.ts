// api/safety-router.ts - Per-trip "Travel guidance" from official, public,
// keyless feeds (the same data Google Travel / government sites surface):
//
//   1. US Department of State Travel Advisories (public RSS).
//      NOTE: the legacy feed https://travel.state.gov/_res/rss/TAs.xml still
//      answers HTTP 200 but with an EMPTY channel (0 items) since the advisory
//      redesign. The populated official feed on the same host is
//      https://travel.state.gov/_res/rss/TAsTWs.xml (also what independent
//      aggregators such as global.fsu.edu subscribe to). We try TAsTWs.xml
//      first and fall back to TAs.xml; a feed that yields zero parsed items
//      is treated as unavailable, never as "no advisories exist".
//   2. GDACS (UN/EU Global Disaster Alert & Coordination System, public RSS)
//      https://www.gdacs.org/xml/rss.xml - earthquakes, cyclones, floods,
//      volcanoes, droughts, wildfires with coordinates + Green/Orange/Red
//      alert level. Filtered to the destination country, or within ~1000 km
//      of the trip centroid when coordinates are known, last 60 days.
//   3. ReliefWeb API (UN OCHA public API; carries WHO Disease Outbreak News).
//      NOTE: api.reliefweb.int/v1 was decommissioned (HTTP 410) and v2
//      requires an approved `appname` (unregistered names get HTTP 403). We
//      call v2 with RELIEFWEB_APPNAME (default "wayfare"); a rejection simply
//      degrades the health section. Last 120 days.
//
// Every fetch is fail-soft: a blocked/unreachable feed returns its section as
// unavailable (degraded:true) - nothing throws, nothing is fabricated.
// Results are cached persistently in the api_cache table (api/lib/cache.ts):
// RSS feeds 6h, ReliefWeb 24h, aggregated guidance 6h - failures 15 min so a
// transient egress block doesn't degrade the app for hours.

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { cacheGet, cacheKey, cacheSet } from "./lib/cache";
import { fetchJson as fetchJsonSafe } from "./lib/http";
import { geocodeCity } from "./queries/overpass";

// ─── Payload types (consumed by src/components/workspace/SafetyCard.tsx) ────

export type AdvisoryLevel = 1 | 2 | 3 | 4;

export type GovernmentAdvisory = {
  level: AdvisoryLevel | null;
  levelLabel: string; // official label, e.g. "Exercise Increased Caution"
  summary: string;
  updated: string; // ISO YYYY-MM-DD from the feed item
  url: string; // full advisory on travel.state.gov
  country: string; // country name as published in the feed
};

export type NaturalEvent = {
  kind: "earthquake" | "cyclone" | "flood" | "volcano" | "drought" | "wildfire" | "other";
  title: string;
  severity: "Red" | "Orange" | "Green"; // GDACS alert level
  severityDetail: string; // e.g. "Magnitude 5.5M, Depth:35km"
  date: string; // ISO YYYY-MM-DD
  country: string;
  url: string;
  distanceKm?: number; // from the trip centroid, when coordinates are known
};

export type HealthNotice = {
  title: string;
  date: string; // ISO YYYY-MM-DD
  snippet: string;
  url: string;
  source: string; // e.g. "World Health Organization"
};

export type Tone = "normal" | "caution" | "warning" | "avoid";

export type TravelGuidance = {
  advisory: GovernmentAdvisory | null;
  events: NaturalEvent[];
  health: HealthNotice[];
  overallTone: Tone;
  sources: string[]; // sources that responded with usable data
  unavailable: string[]; // sources that failed / were unreachable
  degraded: boolean;
  country: string | null; // resolved destination country (feed name)
  /** Canonical destination country actually used (same as `country`; explicit for UI). */
  resolvedCountry: string | null;
  /** True when the destination was a city that we mapped up to its country -
   *  the UI subtitles the card "Countrywide guidance" in that case. */
  destinationIsCity: boolean;
};

const STATE_DEPT = "US State Dept";
const GDACS = "GDACS";
const RELIEFWEB = "WHO via ReliefWeb";

const STATE_DEPT_FEEDS = [
  "https://travel.state.gov/_res/rss/TAsTWs.xml", // populated combined feed
  "https://travel.state.gov/_res/rss/TAs.xml", // legacy URL (empty channel today)
];
const GDACS_FEED = "https://www.gdacs.org/xml/rss.xml";
const RELIEFWEB_ENDPOINT = "https://api.reliefweb.int/v2/reports";
const RELIEFWEB_APPNAME = process.env.RELIEFWEB_APPNAME ?? "wayfare";

const TTL_OK = 6 * 60 * 60 * 1000; // 6h - RSS feeds + aggregated guidance
const TTL_RELIEFWEB = 24 * 60 * 60 * 1000; // 24h - health notices change slowly
const TTL_FAIL = 15 * 60 * 1000;
const GDACS_WINDOW_DAYS = 60;
const RELIEFWEB_WINDOW_DAYS = 120;
const NEARBY_KM = 1000;

// ─── Small XML helpers (no new deps - light regex/string parsing) ───────────

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Inner text of the first `<name …>…</name>` element (namespaced ok). */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]).trim() : null;
}

function xmlItems(xml: string): string[] {
  const out: string[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  // Date-only strings ("Mon, 20 Jul 2026") must be read as UTC - Date.parse
  // otherwise treats them as local midnight and the ISO day can shift.
  const t = Date.parse(raw.includes(":") ? raw : `${raw.trim()} 00:00:00 GMT`);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function stripHtml(html: string): string {
  return decodeXml(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Fail-soft fetching + feed cache ────────────────────────────────────────

async function fetchText(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "wayfare/1.0 (travel guidance; +https://wayfare.app)",
        accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

type JsonRecord = Record<string, unknown>;

async function fetchJson(url: string, timeoutMs = 12000): Promise<JsonRecord | null> {
  try {
    // Shared safe fetcher: HTML error pages / non-2xx / timeouts all surface
    // as typed ExternalApiError - this wrapper stays fail-soft (null).
    return (await fetchJsonSafe<JsonRecord>(url, {
      timeoutMs,
      userAgent: "wayfare/1.0 (travel guidance)",
      service: "travel-guidance",
    })) as JsonRecord;
  } catch {
    return null;
  }
}

/**
 * Fail-soft feed fetch with a persistent api_cache read-through (success 6h,
 * failures negatively cached 15 min). `ns` is the cache namespace:
 * `adv` for the State Dept feeds, `gdacs` for the GDACS RSS.
 */
async function fetchTextCached(url: string, ns: "adv" | "gdacs"): Promise<string | null> {
  const key = `${ns}:feed:${url}`;
  type Envelope = { body: string | null };
  const hit = await cacheGet<Envelope>(key);
  if (hit !== null) return hit.body;
  const body = await fetchText(url);
  await cacheSet(key, { body } satisfies Envelope, body ? TTL_OK : TTL_FAIL);
  return body;
}

// ─── Country normalization ──────────────────────────────────────────────────
// Destinations are free text ("Kyoto, Japan", "Tokyo", "Lisbon, Portugal").
// Strategy: curated tables (country-name variants + ~130 destination cities)
// → exact match against the feed's country list → substring match against
// the feed's country list → (async, rigorous path) Photon geocode → country.

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** normalized country-name variant → country name as published in the State Dept feed. */
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  scotland: "United Kingdom",
  wales: "United Kingdom",
  usa: "United States",
  "u s a": "United States",
  "u s": "United States",
  america: "United States",
  "united states": "United States",
  "united states of america": "United States",
  uae: "United Arab Emirates",
  myanmar: "Burma",
  turkiye: "Turkey",
  "ivory coast": "Côte d’Ivoire",
  "cote d ivoire": "Côte d’Ivoire",
  "cote divoire": "Côte d’Ivoire",
  kyrgyzstan: "The Kyrgyz Republic",
  denmark: "Kingdom of Denmark",
  korea: "South Korea",
  "south korea": "South Korea",
  "korea south": "South Korea",
  "republic of korea": "South Korea",
  dprk: "North Korea",
  "north korea": "North Korea",
  congo: "Republic of the Congo",
  "congo brazzaville": "Republic of the Congo",
  drc: "Democratic Republic of the Congo",
  "dr congo": "Democratic Republic of the Congo",
  "congo kinshasa": "Democratic Republic of the Congo",
  bahamas: "The Bahamas",
  gambia: "The Gambia",
  "czech republic": "Czechia",
  swaziland: "Eswatini",
  "cape verde": "Cabo Verde",
  "east timor": "Timor-Leste",
  "sao tome": "São Tomé and Príncipe",
  "sao tome and principe": "São Tomé and Príncipe",
  curacao: "Curaçao",
  micronesia: "Federated States of Micronesia",
  "mainland china": "China",
  macao: "Macau",
  holland: "Netherlands",
  "russian federation": "Russia",
  "viet nam": "Vietnam",
  saudi: "Saudi Arabia",
  ksa: "Saudi Arabia",
};

/**
 * Curated destination cities (~130) → country. Used when trip.destination is
 * a bare city ("Tokyo") with no country segment - the advisory is issued per
 * COUNTRY, so the city must be mapped up. Anything not listed here falls back
 * to a (cached) Photon geocode in resolveDestinationCountry.
 */
const CITY_TO_COUNTRY: Record<string, string> = {
  // ── East / Southeast / South Asia ──
  tokyo: "Japan",
  kyoto: "Japan",
  osaka: "Japan",
  sapporo: "Japan",
  fukuoka: "Japan",
  nara: "Japan",
  seoul: "South Korea",
  busan: "South Korea",
  beijing: "China",
  shanghai: "China",
  guangzhou: "China",
  shenzhen: "China",
  chengdu: "China",
  "xi an": "China",
  taipei: "Taiwan",
  "hong kong": "Hong Kong",
  bangkok: "Thailand",
  "chiang mai": "Thailand",
  phuket: "Thailand",
  hanoi: "Vietnam",
  "ho chi minh": "Vietnam",
  "da nang": "Vietnam",
  singapore: "Singapore",
  "kuala lumpur": "Malaysia",
  penang: "Malaysia",
  bali: "Indonesia",
  jakarta: "Indonesia",
  manila: "Philippines",
  cebu: "Philippines",
  "phnom penh": "Cambodia",
  "siem reap": "Cambodia",
  vientiane: "Laos",
  yangon: "Burma",
  delhi: "India",
  "new delhi": "India",
  mumbai: "India",
  jaipur: "India",
  chennai: "India",
  kolkata: "India",
  bengaluru: "India",
  bangalore: "India",
  hyderabad: "India",
  goa: "India",
  kochi: "India",
  agra: "India",
  varanasi: "India",
  udaipur: "India",
  amritsar: "India",
  madurai: "India",
  thiruvananthapuram: "India",
  kathmandu: "Nepal",
  colombo: "Sri Lanka",
  dhaka: "Bangladesh",
  islamabad: "Pakistan",
  lahore: "Pakistan",
  karachi: "Pakistan",
  male: "Maldives",
  // ── Europe ──
  paris: "France",
  nice: "France",
  lyon: "France",
  marseille: "France",
  bordeaux: "France",
  strasbourg: "France",
  london: "United Kingdom",
  edinburgh: "United Kingdom",
  manchester: "United Kingdom",
  birmingham: "United Kingdom",
  rome: "Italy",
  milan: "Italy",
  venice: "Italy",
  florence: "Italy",
  naples: "Italy",
  turin: "Italy",
  bologna: "Italy",
  barcelona: "Spain",
  madrid: "Spain",
  seville: "Spain",
  valencia: "Spain",
  malaga: "Spain",
  bilbao: "Spain",
  lisbon: "Portugal",
  porto: "Portugal",
  faro: "Portugal",
  berlin: "Germany",
  munich: "Germany",
  hamburg: "Germany",
  cologne: "Germany",
  frankfurt: "Germany",
  amsterdam: "Netherlands",
  rotterdam: "Netherlands",
  brussels: "Belgium",
  bruges: "Belgium",
  vienna: "Austria",
  salzburg: "Austria",
  innsbruck: "Austria",
  zurich: "Switzerland",
  geneva: "Switzerland",
  basel: "Switzerland",
  prague: "Czechia",
  budapest: "Hungary",
  warsaw: "Poland",
  krakow: "Poland",
  dubrovnik: "Croatia",
  split: "Croatia",
  zagreb: "Croatia",
  athens: "Greece",
  santorini: "Greece",
  mykonos: "Greece",
  istanbul: "Turkey",
  cappadocia: "Turkey",
  antalya: "Turkey",
  reykjavik: "Iceland",
  oslo: "Norway",
  bergen: "Norway",
  stockholm: "Sweden",
  gothenburg: "Sweden",
  copenhagen: "Kingdom of Denmark",
  helsinki: "Finland",
  tallinn: "Estonia",
  riga: "Latvia",
  vilnius: "Lithuania",
  dublin: "Ireland",
  galway: "Ireland",
  sofia: "Bulgaria",
  bucharest: "Romania",
  belgrade: "Serbia",
  ljubljana: "Slovenia",
  bratislava: "Slovakia",
  kyiv: "Ukraine",
  moscow: "Russia",
  "st petersburg": "Russia",
  valletta: "Malta",
  nicosia: "Cyprus",
  luxembourg: "Luxembourg",
  monaco: "Monaco",
  // ── Middle East / Central Asia ──
  dubai: "United Arab Emirates",
  "abu dhabi": "United Arab Emirates",
  doha: "Qatar",
  riyadh: "Saudi Arabia",
  jeddah: "Saudi Arabia",
  muscat: "Oman",
  "kuwait city": "Kuwait",
  manama: "Bahrain",
  amman: "Jordan",
  beirut: "Lebanon",
  "tel aviv": "Israel",
  jerusalem: "Israel",
  tbilisi: "Georgia",
  yerevan: "Armenia",
  baku: "Azerbaijan",
  almaty: "Kazakhstan",
  tashkent: "Uzbekistan",
  // ── Americas ──
  "new york": "United States",
  "los angeles": "United States",
  "san francisco": "United States",
  "las vegas": "United States",
  miami: "United States",
  orlando: "United States",
  chicago: "United States",
  boston: "United States",
  seattle: "United States",
  "washington dc": "United States",
  "new orleans": "United States",
  honolulu: "United States",
  "san diego": "United States",
  austin: "United States",
  nashville: "United States",
  denver: "United States",
  atlanta: "United States",
  toronto: "Canada",
  vancouver: "Canada",
  montreal: "Canada",
  calgary: "Canada",
  quebec: "Canada",
  cancun: "Mexico",
  "mexico city": "Mexico",
  "rio de janeiro": "Brazil",
  "sao paulo": "Brazil",
  "buenos aires": "Argentina",
  santiago: "Chile",
  lima: "Peru",
  cusco: "Peru",
  bogota: "Colombia",
  medellin: "Colombia",
  cartagena: "Colombia",
  quito: "Ecuador",
  "la paz": "Bolivia",
  asuncion: "Paraguay",
  montevideo: "Uruguay",
  "panama city": "Panama",
  havana: "Cuba",
  "punta cana": "Dominican Republic",
  "santo domingo": "Dominican Republic",
  "san juan": "Puerto Rico",
  kingston: "Jamaica",
  nassau: "The Bahamas",
  // ── Africa ──
  cairo: "Egypt",
  luxor: "Egypt",
  "sharm el sheikh": "Egypt",
  marrakech: "Morocco",
  marrakesh: "Morocco",
  casablanca: "Morocco",
  fez: "Morocco",
  tunis: "Tunisia",
  "cape town": "South Africa",
  johannesburg: "South Africa",
  durban: "South Africa",
  nairobi: "Kenya",
  mombasa: "Kenya",
  zanzibar: "Tanzania",
  "dar es salaam": "Tanzania",
  arusha: "Tanzania",
  kampala: "Uganda",
  kigali: "Rwanda",
  "addis ababa": "Ethiopia",
  accra: "Ghana",
  lagos: "Nigeria",
  dakar: "Senegal",
  windhoek: "Namibia",
  "victoria falls": "Zimbabwe",
  mauritius: "Mauritius",
  antananarivo: "Madagascar",
  // ── Oceania ──
  sydney: "Australia",
  melbourne: "Australia",
  brisbane: "Australia",
  perth: "Australia",
  adelaide: "Australia",
  canberra: "Australia",
  "gold coast": "Australia",
  cairns: "Australia",
  auckland: "New Zealand",
  queenstown: "New Zealand",
  wellington: "New Zealand",
  christchurch: "New Zealand",
  nadi: "Fiji",
};

/** normalized alias (country variant OR city) → country name as published in the State Dept feed. */
const COUNTRY_ALIASES: Record<string, string> = {
  ...CITY_TO_COUNTRY,
  ...COUNTRY_NAME_ALIASES,
};

/** Raw last comma-segment of a free-text destination ("Kyoto, Japan" → "Japan"). */
function fallbackCountryName(destination: string): string {
  const parts = destination.split(/[,/|;]+/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : destination.trim();
}

/**
 * Resolve a free-text destination to a country name from `feedCountries`
 * (the live State Dept feed list; empty when that feed is down).
 */
export function resolveCountryName(destination: string, feedCountries: string[]): string | null {
  const feedByNorm = new Map(feedCountries.map((c) => [normalizeName(c), c]));
  const parts = destination.split(/[,/|;]+/).map(normalizeName).filter(Boolean);
  // Country usually comes last ("Kyoto, Japan"); try parts last→first, then whole string.
  const ordered = [...parts.reverse(), normalizeName(destination)];
  for (const cand of ordered) {
    if (!cand) continue;
    if (COUNTRY_ALIASES[cand]) return COUNTRY_ALIASES[cand];
    const exact = feedByNorm.get(cand);
    if (exact) return exact;
  }
  // Substring fallback against the feed's country list (longest match wins).
  for (const cand of ordered) {
    if (!cand || cand.length < 4) continue;
    let best: string | null = null;
    for (const [norm, orig] of feedByNorm) {
      if (cand.includes(norm) || (norm.length >= 5 && norm.includes(cand))) {
        if (!best || norm.length > normalizeName(best).length) best = orig;
      }
    }
    if (best) return best;
  }
  // Whole-string alias scan (e.g. "Trip to Bali 2026").
  const whole = normalizeName(destination);
  for (const [alias, country] of Object.entries(COUNTRY_ALIASES)) {
    if (alias.length >= 4 && whole.includes(alias)) return country;
  }
  return null;
}

export type CountryResolution = {
  /** Canonical country (State Dept feed spelling when the feed is reachable). */
  country: string;
  /** table = curated city table, feed = country named directly, geocode = Photon lookup. */
  via: "table" | "feed" | "geocode";
  /** True when the destination is a city we mapped up to its country. */
  wasCity: boolean;
};

/**
 * Rigorous destination → COUNTRY resolution (advisories are issued per
 * country, never per city). Order:
 *   1. `resolveCountryName` - curated tables + feed country list.
 *   2. Photon geocode of the leading segment (cached 30d in api_cache) →
 *      country, re-mapped through the feed list for the official spelling
 *      (e.g. "Thoothukudi" → India; "Tokyo" never needs this - it's curated).
 * Returns null when nothing can resolve the destination.
 */
export async function resolveDestinationCountry(
  destination: string,
  feedCountries: string[],
): Promise<CountryResolution | null> {
  const direct = resolveCountryName(destination, feedCountries);
  if (direct) {
    // The destination explicitly NAMES a country when one of its segments is
    // a feed country or a country-name alias ("Kyoto, Japan", "Myanmar");
    // otherwise the match came from the curated city table → it was a city.
    const feedNorms = new Set(feedCountries.map(normalizeName));
    const namesCountry = destination
      .split(/[,/|;]+/)
      .map(normalizeName)
      .filter(Boolean)
      .some((p) => feedNorms.has(p) || COUNTRY_NAME_ALIASES[p] !== undefined);
    return { country: direct, via: namesCountry ? "feed" : "table", wasCity: !namesCountry };
  }
  const lead = (destination.split(/[,/|;]+/)[0] ?? destination).trim();
  if (!lead) return null;
  try {
    const geo = await geocodeCity(lead);
    if (geo?.country) {
      // Map the geocoded country onto the feed's official spelling when possible.
      const viaFeed = resolveCountryName(geo.country, feedCountries);
      return { country: viaFeed ?? geo.country, via: "geocode", wasCity: true };
    }
  } catch {
    /* geocoding is best-effort; fall through to null */
  }
  return null;
}

// ─── 1) US State Dept travel advisories ─────────────────────────────────────

type FeedAdvisory = {
  country: string;
  norm: string;
  level: AdvisoryLevel;
  levelLabel: string;
  updated: string;
  url: string;
};

const LEVEL_LABEL: Record<AdvisoryLevel, string> = {
  1: "Exercise Normal Precautions",
  2: "Exercise Increased Caution",
  3: "Reconsider Travel",
  4: "Do Not Travel",
};

export function parseStateDept(xml: string): FeedAdvisory[] {
  const byNorm = new Map<string, FeedAdvisory>();
  for (const item of xmlItems(xml)) {
    const title = tag(item, "title") ?? "";
    // "Japan - Level 1: Exercise Normal Precautions"; some titles carry an
    // extra segment ("Mainland China, Hong Kong & Macau - See Summaries - Level 2: …").
    const m = title.match(/^(.*?)\s*-\s*(?:See Summaries\s*-\s*)?Level\s+([1-4])\s*:\s*(.+)$/i);
    if (!m) continue;
    const country = m[1]
      .replace(/\s+/g, " ")
      .replace(/\s*Travel Advisory$/i, "")
      .trim();
    const norm = normalizeName(country);
    if (!norm) continue;
    const level = Number(m[2]) as AdvisoryLevel;
    const updated = toIsoDate(tag(item, "pubDate")) ?? "";
    const entry: FeedAdvisory = {
      country,
      norm,
      level,
      levelLabel: LEVEL_LABEL[level],
      updated,
      url: tag(item, "link") ?? "",
    };
    const prev = byNorm.get(norm);
    if (!prev || (updated && (!prev.updated || updated > prev.updated))) byNorm.set(norm, entry);
  }
  return [...byNorm.values()];
}

/** Parsed advisories from the first reachable, non-empty official feed. */
async function getStateDeptAdvisories(): Promise<FeedAdvisory[] | null> {
  for (const url of STATE_DEPT_FEEDS) {
    const xml = await fetchTextCached(url, "adv");
    if (!xml) continue;
    const parsed = parseStateDept(xml);
    if (parsed.length > 0) return parsed;
  }
  return null;
}

// ─── 2) GDACS natural-event alerts ──────────────────────────────────────────

type GdacsEvent = NaturalEvent & { lat?: number; lng?: number };

const GDACS_KIND: Record<string, NaturalEvent["kind"]> = {
  EQ: "earthquake",
  TC: "cyclone",
  FL: "flood",
  VO: "volcano",
  DR: "drought",
  WF: "wildfire",
};

/** Titles read e.g. "Orange flood in Indonesia 12/07/2026 …" → "Indonesia". */
function countryFromGdacsTitle(title: string): string {
  const m = title.match(/\bin\s+([A-Za-z][A-Za-z .,'-]*?)\s+\d{2}\/\d{2}\/\d{4}/);
  return m ? m[1].trim() : "";
}

export function parseGdacs(xml: string): GdacsEvent[] {
  const byId = new Map<string, GdacsEvent>();
  for (const item of xmlItems(xml)) {
    const title = tag(item, "title") ?? "";
    const date = toIsoDate(tag(item, "gdacs:fromdate") ?? tag(item, "pubDate"));
    if (!title || !date) continue;
    const alert = tag(item, "gdacs:alertlevel") ?? "Green";
    const severity: NaturalEvent["severity"] =
      alert === "Red" || alert === "Orange" ? alert : "Green";
    const lat = Number(tag(item, "geo:lat"));
    const lng = Number(tag(item, "geo:long"));
    const id = tag(item, "gdacs:eventid") ?? tag(item, "guid") ?? title;
    const ev: GdacsEvent = {
      kind: GDACS_KIND[(tag(item, "gdacs:eventtype") ?? "").toUpperCase()] ?? "other",
      title,
      severity,
      severityDetail: tag(item, "gdacs:severity") ?? "",
      date,
      country: tag(item, "gdacs:country") ?? countryFromGdacsTitle(title),
      url: tag(item, "link") ?? "",
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    };
    const prev = byId.get(id);
    if (!prev || date >= prev.date) byId.set(id, ev); // newest episode per event
  }
  return [...byId.values()];
}

function gdacsCountryMatches(eventCountry: string, targetNorm: string): boolean {
  if (!targetNorm) return false;
  return eventCountry
    .split(/[,;]+/)
    .map(normalizeName)
    .some((seg) => seg !== "" && (seg === targetNorm || seg.replace(/^the /, "") === targetNorm.replace(/^the /, "")));
}

// ─── 3) ReliefWeb (WHO Disease Outbreak News + OCHA health reports) ─────────

async function getHealthNotices(country: string): Promise<HealthNotice[] | null> {
  const key = `rw:${normalizeName(country)}`;
  type Envelope = { items: HealthNotice[] | null };
  const hit = await cacheGet<Envelope>(key);
  if (hit !== null) return hit.items;

  const now = Date.now();
  const u = new URL(RELIEFWEB_ENDPOINT);
  u.searchParams.set("appname", RELIEFWEB_APPNAME);
  u.searchParams.set("profile", "list");
  u.searchParams.set("preset", "latest");
  u.searchParams.set("limit", "10");
  u.searchParams.set("query[value]", country);
  u.searchParams.append("query[fields][]", "country");
  u.searchParams.set("filter[field]", "theme.name");
  u.searchParams.set("filter[value]", "Health");
  u.searchParams.append("sort[]", "date.created:desc");
  for (const f of ["title", "date.created", "source", "url_alias", "body"]) {
    u.searchParams.append("fields[include][]", f);
  }

  const res = await fetchJson(u.toString());
  let items: HealthNotice[] | null = null;
  if (res && Array.isArray(res.data)) {
    const cutoff = now - RELIEFWEB_WINDOW_DAYS * 86_400_000;
    items = [];
    for (const row of res.data) {
      const f = row?.fields ?? {};
      const ts = Date.parse(f?.date?.created ?? "");
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const source =
        Array.isArray(f.source) && f.source[0]?.name ? String(f.source[0].name) : "ReliefWeb";
      items.push({
        title: String(f.title ?? "Untitled"),
        date: new Date(ts).toISOString().slice(0, 10),
        snippet: typeof f.body === "string" ? stripHtml(f.body).slice(0, 240) : "",
        url: typeof f.url_alias === "string" ? f.url_alias : "",
        source,
      });
      if (items.length >= 5) break;
    }
  }
  await cacheSet(key, { items } satisfies Envelope, items ? TTL_RELIEFWEB : TTL_FAIL);
  return items;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

const TONES: Tone[] = ["normal", "caution", "warning", "avoid"];

/** Core aggregation - never throws; degraded sections are marked unavailable. */
export async function getTravelGuidance(input: {
  country: string;
  lat?: number;
  lng?: number;
}): Promise<TravelGuidance> {
  const key = cacheKey(
    "adv:guid:",
    `${normalizeName(input.country)}|${input.lat?.toFixed(2) ?? ""}|${input.lng?.toFixed(2) ?? ""}`,
  );
  const cached = await cacheGet<TravelGuidance>(key);
  if (cached !== null) return cached;

  const sources: string[] = [];
  const unavailable: string[] = [];

  // Feeds are fetched in parallel; each one fails soft.
  const [advisories, gdacsXml] = await Promise.all([
    getStateDeptAdvisories(),
    fetchTextCached(GDACS_FEED, "gdacs"),
  ]);

  // ── Destination COUNTRY (advisories are per-country, never per-city) ──
  // Curated city table → feed country match → cached Photon geocode.
  const resolution = await resolveDestinationCountry(
    input.country,
    advisories ? advisories.map((a) => a.country) : [],
  );

  // ── Government advisory ──
  let advisory: GovernmentAdvisory | null = null;
  if (advisories) {
    sources.push(STATE_DEPT);
    const norm = resolution ? normalizeName(resolution.country) : null;
    const match = norm ? advisories.find((a) => a.norm === norm) : undefined;
    if (match) {
      advisory = {
        level: match.level,
        levelLabel: match.levelLabel,
        summary: `US State Department travel advisory for ${match.country}: Level ${match.level}, ${match.levelLabel}.`,
        updated: match.updated,
        url: match.url,
        country: match.country,
      };
    }
  } else {
    unavailable.push(STATE_DEPT);
  }
  const countryQuery = resolution?.country ?? fallbackCountryName(input.country);

  // ── Natural events (last 60 days, country match or ≤1000 km) ──
  let events: NaturalEvent[] = [];
  if (gdacsXml) {
    sources.push(GDACS);
    const cutoff = Date.now() - GDACS_WINDOW_DAYS * 86_400_000;
    const target = normalizeName(countryQuery);
    const haveCoords = input.lat != null && input.lng != null;
    events = parseGdacs(gdacsXml)
      .filter((e) => Date.parse(e.date) >= cutoff)
      .map((e) => {
        const distanceKm =
          haveCoords && e.lat != null && e.lng != null
            ? Math.round(haversineKm(input.lat as number, input.lng as number, e.lat, e.lng))
            : undefined;
        return { ...e, distanceKm };
      })
      .filter((e) => gdacsCountryMatches(e.country, target) || (e.distanceKm != null && e.distanceKm <= NEARBY_KM))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 8)
      .map((e) => ({
        kind: e.kind,
        title: e.title,
        severity: e.severity,
        severityDetail: e.severityDetail,
        date: e.date,
        country: e.country,
        url: e.url,
        distanceKm: e.distanceKm,
      }));
  } else {
    unavailable.push(GDACS);
  }

  // ── Health notices (last 120 days) ──
  let health: HealthNotice[] = [];
  try {
    const notices = await getHealthNotices(countryQuery);
    if (notices) {
      sources.push(RELIEFWEB);
      health = notices;
    } else {
      unavailable.push(RELIEFWEB);
    }
  } catch {
    unavailable.push(RELIEFWEB);
  }

  // Tone: State Dept level 1–4 → normal/caution/warning/avoid, bumped one
  // step by an active red-level GDACS event nearby.
  let idx = advisory?.level ? advisory.level - 1 : 0;
  if (events.some((e) => e.severity === "Red")) idx = Math.min(idx + 1, TONES.length - 1);

  const value: TravelGuidance = {
    advisory,
    events,
    health,
    overallTone: TONES[idx],
    sources,
    unavailable,
    degraded: unavailable.length > 0,
    country: resolution?.country ?? (countryQuery || null),
    resolvedCountry: resolution?.country ?? (countryQuery || null),
    destinationIsCity: resolution?.wasCity ?? false,
  };
  // Degraded results are cached briefly (15 min) so a transient feed outage
  // doesn't get pinned for hours; healthy results get the full 6h.
  await cacheSet(key, value, value.degraded ? TTL_FAIL : TTL_OK);
  return value;
}

// ─── Router ─────────────────────────────────────────────────────────────────

/** Membership guard - same rule as trip-router's requireMembership. */
async function requireTripMembership(tripId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tripMembers)
    .where(
      and(eq(schema.tripMembers.tripId, tripId), eq(schema.tripMembers.userId, userId)),
    )
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this trip" });
  }
  return rows[0];
}

export const safetyRouter = createRouter({
  /**
   * Guidance for an arbitrary destination string, optionally refined by
   * coordinates (GDACS proximity filter).
   */
  travelAdvisory: authedQuery
    .input(
      z.object({
        country: z.string().min(1).max(160),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
    )
    .query(({ input }) => getTravelGuidance(input)),

  /**
   * Guidance for a trip: the destination COUNTRY is resolved rigorously from
   * trip.destination (curated city table → feed match → cached Photon
   * geocode, since advisories are issued per country, not per city);
   * coordinates come from the stop centroid (falling back to the hotel,
   * then the road-trip origin). Membership-guarded like every trip query.
   */
  tripAdvisory: authedQuery
    .input(z.object({ tripId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireTripMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db
        .select()
        .from(schema.trips)
        .where(eq(schema.trips.id, input.tripId))
        .limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });

      const stopRows = await db
        .select({ lat: schema.stops.lat, lng: schema.stops.lng })
        .from(schema.stops)
        .where(eq(schema.stops.tripId, input.tripId));
      const pts = stopRows.filter(
        (s): s is { lat: number; lng: number } => s.lat != null && s.lng != null,
      );

      let lat: number | undefined;
      let lng: number | undefined;
      if (pts.length) {
        lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
        lng = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
      } else if (trip.hotelLat != null && trip.hotelLng != null) {
        lat = trip.hotelLat;
        lng = trip.hotelLng;
      } else if (trip.originLat != null && trip.originLng != null) {
        lat = trip.originLat;
        lng = trip.originLng;
      }
      return getTravelGuidance({ country: trip.destination, lat, lng });
    }),
});
