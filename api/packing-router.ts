// api/packing-router.ts - Smart packing list generator (Voyager-only).
//
// Data-driven rules engine: trip dates × per-day weather (api/lib/weather.ts)
// × destination country (geocode) × travel styles (user taste profile) ×
// trip type / children → a grouped packing list. Generated rows are persisted
// as checklist_items (list='packing') with the label prefix "✦ " so they can
// be told apart from hand-written items and replaced/cleared wholesale.

import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { getTier } from "./queries/subscriptions";
import { geocodeCity } from "./queries/overpass";
import { getDayWeather, weatherLabel, type DayWeather } from "./lib/weather";

export const GENERATED_PREFIX = "✦ ";

const GROUPS = [
  "Clothing",
  "Gear",
  "Documents",
  "Health",
  "Kids",
  "Tech",
  "Toiletries",
] as const;
type GroupKey = (typeof GROUPS)[number];

export type PackingItemOut = { label: string; why?: string };
export type PackingGroupOut = { group: GroupKey; items: PackingItemOut[] };

/* ── curated country tables ─────────────────────────────────────────────── */

/** Socket plug type(s) by country (~50 countries). */
const PLUG_TYPES: Record<string, string> = {
  "United States": "A/B",
  Canada: "A/B",
  Mexico: "A/B",
  Japan: "A/B",
  Taiwan: "A/B",
  Colombia: "A/B",
  Peru: "A/C",
  Brazil: "C/N",
  Chile: "C/L",
  Argentina: "C/I",
  "United Kingdom": "G",
  Ireland: "G",
  Malta: "G",
  Cyprus: "G",
  Malaysia: "G",
  Singapore: "G",
  "Hong Kong": "G",
  Kenya: "G",
  Tanzania: "D/G",
  France: "C/E",
  Germany: "C/F",
  Spain: "C/F",
  Italy: "C/F/L",
  Netherlands: "C/F",
  Portugal: "C/F",
  Greece: "C/F",
  Austria: "C/F",
  Belgium: "C/E",
  Poland: "C/E",
  Czechia: "C/E",
  Hungary: "C/F",
  Croatia: "C/F",
  Switzerland: "C/J",
  Sweden: "C/F",
  Norway: "C/F",
  Denmark: "C/K",
  Finland: "C/F",
  Iceland: "C/F",
  Turkey: "C/F",
  Egypt: "C/F",
  Morocco: "C/E",
  Russia: "C/F",
  "South Korea": "C/F",
  Indonesia: "C/F",
  Thailand: "A/B/C",
  Vietnam: "A/C",
  Philippines: "A/B/C",
  Cambodia: "A/C/G",
  India: "C/D/M",
  Nepal: "C/D/M",
  "Sri Lanka": "D/G/M",
  China: "A/C/I",
  Israel: "C/H",
  Jordan: "C/G",
  "United Arab Emirates": "G",
  "South Africa": "C/M/N",
  Australia: "I",
  "New Zealand": "I",
};

/** Schengen/Eurozone bloc - used when the user's home currency is EUR. */
const EUROZONE = new Set([
  "Austria", "Belgium", "Croatia", "Cyprus", "Estonia", "Finland", "France",
  "Germany", "Greece", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg",
  "Malta", "Netherlands", "Portugal", "Slovakia", "Slovenia", "Spain",
  "Czechia", "Hungary", "Poland", "Sweden", "Denmark", "Switzerland", "Norway",
  "Iceland",
]);

/** Mosquito-borne-risk / tropical destinations → repellent rules. */
const TROPICAL = new Set([
  "Thailand", "Vietnam", "Cambodia", "Laos", "Indonesia", "Malaysia",
  "Singapore", "Philippines", "India", "Sri Lanka", "Nepal", "Myanmar",
  "Brazil", "Peru", "Colombia", "Ecuador", "Costa Rica", "Panama", "Mexico",
  "Cuba", "Dominican Republic", "Kenya", "Tanzania", "Uganda", "Ghana",
  "Nigeria", "Madagascar",
]);

/** High-altitude destinations (matched against the destination string). */
const HIGH_ALTITUDE_RE =
  /cusco|la paz|quito|kathmandu|lhasa|leh|machu picchu|bogot|titicaca|kilimanjaro|addis ababa|mexico city|denver|el chalt/i;

/** Beach-y destinations (matched against the destination string). */
const BEACH_RE =
  /beach|bali|hawaii|canc[úu]n|positano|amalfi|mallorca|ibiza|phuket|maldives|boracay|goa|tulum|oahu|maui|nice\b|barcelona|rio de janeiro|gold coast|santorini|mykonos|cancun/i;

/** Best-effort home country guess from the user's home currency. */
const CURRENCY_COUNTRY: Record<string, string> = {
  USD: "United States",
  EUR: "Eurozone",
  GBP: "United Kingdom",
  JPY: "Japan",
  AUD: "Australia",
  NZD: "New Zealand",
  CAD: "Canada",
  CHF: "Switzerland",
  CNY: "China",
  KRW: "South Korea",
  SGD: "Singapore",
  HKD: "Hong Kong",
  THB: "Thailand",
  INR: "India",
  BRL: "Brazil",
  MXN: "Mexico",
  SEK: "Sweden",
  NOK: "Norway",
  DKK: "Denmark",
  PLN: "Poland",
};

/* ── rule context ───────────────────────────────────────────────────────── */

type RuleCtx = {
  days: number;
  country: string; // "" when unknown
  homeCountry: string; // best guess from home currency; "" when unknown
  destination: string;
  /** true = abroad, false = domestic, null = cannot tell */
  international: boolean | null;
  tripType: string; // city | roadtrip
  styles: Set<string>;
  withChildren: boolean;
  childAges: number[];
  // weather facts (defaults are mild when no data could be fetched)
  rainyDays: number; // days with precipMm >= 3
  wetDays: number; // days with precipMm >= 1
  snowDays: number;
  stormDays: number;
  maxT: number;
  minT: number;
  rainLabels: string[]; // distinct condition labels on rainy days
  hasWeather: boolean;
};

type Rule = {
  group: GroupKey;
  label: string | ((c: RuleCtx) => string);
  why?: string | ((c: RuleCtx) => string | undefined);
  when: (c: RuleCtx) => boolean;
};

const always = () => true;
const hot = (c: RuleCtx) => c.maxT >= 28;
const warm = (c: RuleCtx) => c.maxT >= 24;
const cold = (c: RuleCtx) => c.minT <= 5;
const cool = (c: RuleCtx) => c.minT > 5 && c.minT <= 14;
const rainy = (c: RuleCtx) => c.rainyDays > 0;
const snowy = (c: RuleCtx) => c.snowDays > 0;
const swim = (c: RuleCtx) =>
  BEACH_RE.test(c.destination) || (c.styles.has("relaxing") && c.maxT >= 26);
const roadtrip = (c: RuleCtx) => c.tripType === "roadtrip";
const abroad = (c: RuleCtx) => c.international !== false; // true or unknown
const tropical = (c: RuleCtx) => c.country !== "" && TROPICAL.has(c.country);
const highAlt = (c: RuleCtx) => HIGH_ALTITUDE_RE.test(c.destination);
const hasBaby = (c: RuleCtx) => c.childAges.some(a => a <= 2);
const hasYoungKid = (c: RuleCtx) => c.childAges.some(a => a >= 3 && a <= 6);
const hasKid = (c: RuleCtx) => c.childAges.some(a => a >= 7 && a <= 12);
const hasTeen = (c: RuleCtx) => c.childAges.some(a => a >= 13);

const cap = (n: number, max: number) => Math.min(Math.max(n, 1), max);

/** Doc labels get a qualifier when we cannot tell if the trip is abroad. */
const intlLabel = (base: string) => (c: RuleCtx) =>
  c.international === null ? `${base} (if travelling internationally)` : base;

const rainWhy = (c: RuleCtx) =>
  c.rainyDays > 0
    ? `${c.rainyDays} day${c.rainyDays > 1 ? "s" : ""} with rain (${[...new Set(c.rainLabels)].join(", ").toLowerCase()})`
    : undefined;

/* ── the rule table (~115 rules) ────────────────────────────────────────── */

const RULES: Rule[] = [
  /* ── Clothing ── */
  { group: "Clothing", label: c => `Underwear ×${cap(c.days + 2, 12)}`, why: "One per day plus two spares", when: always },
  { group: "Clothing", label: c => `Socks ×${cap(c.days + 2, 12)}`, why: "One pair per day plus spares", when: always },
  { group: "Clothing", label: c => `Tops / t-shirts ×${cap(c.days + 1, 9)}`, when: always },
  { group: "Clothing", label: c => `Bottoms (trousers/shorts) ×${cap(Math.ceil(c.days / 2.5) + 1, 5)}`, when: always },
  { group: "Clothing", label: "Sleepwear", when: always },
  { group: "Clothing", label: "Comfortable walking shoes", why: "Expect 10k+ steps a day while sightseeing", when: always },
  { group: "Clothing", label: "One nicer evening outfit", why: "For dinners and evenings out", when: c => c.days >= 3 },
  { group: "Clothing", label: "Sweater or cardigan", why: c => (c.minT <= 18 ? `Nights dip to ${Math.round(c.minT)}°C` : "Evenings can cool down"), when: c => c.minT <= 18 },
  { group: "Clothing", label: "Breathable / quick-dry tops", why: c => `Highs of ${Math.round(c.maxT)}°C`, when: hot },
  { group: "Clothing", label: "Sun hat or cap", why: c => `Highs of ${Math.round(c.maxT)}°C`, when: hot },
  { group: "Clothing", label: "Shorts or summer skirt", when: warm },
  { group: "Clothing", label: "Sandals", when: c => c.maxT >= 26 },
  { group: "Clothing", label: "Light jacket", why: c => `Mornings around ${Math.round(c.minT)}°C`, when: cool },
  { group: "Clothing", label: "Packable insulated jacket", why: c => `Lows of ${Math.round(c.minT)}°C`, when: cold },
  { group: "Clothing", label: "Thermal base layers", why: c => `Lows of ${Math.round(c.minT)}°C`, when: cold },
  { group: "Clothing", label: "Warm fleece or heavy sweater", when: cold },
  { group: "Clothing", label: "Gloves", when: cold },
  { group: "Clothing", label: "Beanie / warm hat", when: cold },
  { group: "Clothing", label: "Scarf", when: cold },
  { group: "Clothing", label: "Warm wool socks", when: cold },
  { group: "Clothing", label: "Packable rain jacket", why: rainWhy, when: rainy },
  { group: "Clothing", label: "Water-resistant shoes", why: rainWhy, when: rainy },
  { group: "Clothing", label: "Spare pair of socks (wet-day backup)", why: rainWhy, when: rainy },
  { group: "Clothing", label: "Waterproof boots", why: "Snow in the forecast", when: snowy },
  { group: "Clothing", label: "Swimwear ×2", why: "One dries while you wear the other", when: swim },
  { group: "Clothing", label: "Beach cover-up / sarong", when: swim },
  { group: "Clothing", label: "Flip-flops", when: swim },
  { group: "Clothing", label: "Hiking boots or trail shoes", why: "Adventure style in your taste profile", when: c => c.styles.has("adventure") },
  { group: "Clothing", label: "Moisture-wicking hiking socks", when: c => c.styles.has("adventure") },
  { group: "Clothing", label: "Quick-dry hiking trousers", when: c => c.styles.has("adventure") },
  { group: "Clothing", label: "Modest layers (shoulders & knees covered)", why: "Temples and religious sites require them", when: c => c.styles.has("historical") },
  { group: "Clothing", label: "Light shawl for temple visits", when: c => c.styles.has("historical") },
  { group: "Clothing", label: "Loose, stretchy-waist outfit", why: "Long lunches are the point :)", when: c => c.styles.has("food") },
  { group: "Clothing", label: "Smart-casual dinner outfit", why: "For that reservation you'll make", when: c => c.styles.has("food") },
  { group: "Clothing", label: "Comfy car-day outfit", why: "Hours in the driver's seat", when: roadtrip },

  /* ── Gear ── */
  { group: "Gear", label: "Day bag / small backpack", when: always },
  { group: "Gear", label: "Packing cubes", why: "Keeps a multi-day bag organised", when: always },
  { group: "Gear", label: "Laundry bag", when: always },
  { group: "Gear", label: "TSA-friendly luggage lock", when: always },
  { group: "Gear", label: "Reusable water bottle", why: "Hydration without the plastic", when: always },
  { group: "Gear", label: "Compact umbrella", why: rainWhy, when: rainy },
  { group: "Gear", label: "Dry bag / zip-locks for electronics", why: rainWhy, when: rainy },
  { group: "Gear", label: "Sunglasses", when: c => c.maxT >= 20 || snowy(c) },
  { group: "Gear", label: "Quick-dry travel towel", when: c => swim(c) || c.styles.has("adventure") },
  { group: "Gear", label: "Beach bag", when: swim },
  { group: "Gear", label: "Reef shoes", why: "Rocky entries and coral", when: c => BEACH_RE.test(c.destination) },
  { group: "Gear", label: "Hiking daypack with rain cover", when: c => c.styles.has("adventure") },
  { group: "Gear", label: "Trekking poles", when: c => c.styles.has("adventure") && (snowy(c) || highAlt(c)) },
  { group: "Gear", label: "Headlamp", why: "For pre-dawn starts and unlit trails", when: c => c.styles.has("adventure") },
  { group: "Gear", label: "Car phone mount", when: roadtrip },
  { group: "Gear", label: "Insulated cooler bag", why: "Picnics and supermarket stops", when: roadtrip },
  { group: "Gear", label: "Road-trip snacks", when: roadtrip },
  { group: "Gear", label: "Small trash bag for the car", when: roadtrip },
  { group: "Gear", label: "Travel pillow", why: "Long travel day", when: c => abroad(c) && c.days >= 4 },
  { group: "Gear", label: "Eye mask & earplugs", why: "For the flight and bright mornings", when: c => abroad(c) && c.days >= 4 },
  { group: "Gear", label: "Compression socks", why: "Long-haul flight comfort", when: c => c.international === true && c.days >= 5 },
  { group: "Gear", label: "Luggage scale", why: "Avoid surprise baggage fees", when: c => c.international === true && c.days >= 7 },

  /* ── Documents ── */
  { group: "Documents", label: intlLabel("Passport: valid 6+ months beyond return"), why: "Many countries enforce the 6-month rule", when: abroad },
  { group: "Documents", label: intlLabel("Check visa / entry requirements"), why: c => (c.country ? `Entry rules for ${c.country}` : "Entry rules vary by nationality"), when: abroad },
  { group: "Documents", label: intlLabel("Travel insurance details"), why: "Keep policy number and emergency line handy", when: abroad },
  { group: "Documents", label: intlLabel("Photocopies / digital copies of passport & cards"), why: "Faster replacement if anything is lost", when: abroad },
  { group: "Documents", label: intlLabel("Some local currency + a no-foreign-fee card"), when: abroad },
  { group: "Documents", label: "Printed or offline booking confirmations", why: "Flights, stays, transfers, signal dies at the worst times", when: always },
  { group: "Documents", label: "Driver's licence", when: roadtrip },
  { group: "Documents", label: intlLabel("International Driving Permit (check requirement)"), why: "Required by many rental agencies abroad", when: c => roadtrip(c) && abroad(c) },

  /* ── Health ── */
  { group: "Health", label: c => `Personal medications ×${cap(c.days + 2, 14)} doses`, why: "Plus a buffer for delays", when: always },
  { group: "Health", label: "Mini first-aid kit", when: always },
  { group: "Health", label: "Pain & fever reliever", when: always },
  { group: "Health", label: "Hand sanitiser", when: always },
  { group: "Health", label: intlLabel("Copies of prescriptions"), why: "Customs and refills go smoother", when: abroad },
  { group: "Health", label: "Sunscreen SPF 50", why: c => `Highs of ${Math.round(c.maxT)}°C`, when: c => c.maxT >= 22 },
  { group: "Health", label: "Reef-safe sunscreen", why: "Regular sunscreen damages coral", when: swim },
  { group: "Health", label: "After-sun / aloe gel", when: hot },
  { group: "Health", label: "Mosquito repellent (DEET or picaridin)", why: c => `${c.country} is mosquito country`, when: tropical },
  { group: "Health", label: "Antihistamine / after-bite cream", when: tropical },
  { group: "Health", label: "Altitude-sickness plan (ask your doctor)", why: "Destination sits above 2,400m", when: highAlt },
  { group: "Health", label: "Electrolyte sachets", when: c => hot(c) || highAlt(c) },
  { group: "Health", label: "Blister kit / moleskin", why: "New shoes + big walking days", when: c => c.styles.has("adventure") },
  { group: "Health", label: "Motion-sickness tablets", why: "Winding roads", when: roadtrip },
  { group: "Health", label: "Lip balm with SPF", when: c => cold(c) || hot(c) || snowy(c) },

  /* ── Tech ── */
  { group: "Tech", label: "Phone charger", when: always },
  { group: "Tech", label: "Power bank", why: "Maps and photos drain batteries fast", when: always },
  { group: "Tech", label: "Headphones", when: always },
  {
    group: "Tech",
    label: c =>
      c.country && PLUG_TYPES[c.country]
        ? `Travel plug adapter (Type ${PLUG_TYPES[c.country]})${c.international === null ? ", if travelling internationally" : ""}`
        : "Universal travel plug adapter",
    why: c =>
      c.country && PLUG_TYPES[c.country]
        ? `${c.country} uses Type ${PLUG_TYPES[c.country]} sockets`
        : "Socket types vary by country",
    when: c => {
      if (c.international === false) return false; // domestic - same sockets
      // Skip when the destination's plug types are a subset of home's
      // (e.g. US traveller to Japan - both Type A/B).
      const destPlugs = c.country ? PLUG_TYPES[c.country] : undefined;
      const homePlugs = c.homeCountry ? PLUG_TYPES[c.homeCountry] : undefined;
      if (destPlugs && homePlugs) {
        const home = new Set(homePlugs.split("/"));
        if (destPlugs.split("/").every(t => home.has(t))) return false;
      }
      return true;
    },
  },
  { group: "Tech", label: "Camera (or phone lens kit)", why: "This trip is worth more than snapshots", when: c => c.styles.has("adventure") || c.styles.has("historical") },
  { group: "Tech", label: "E-reader", why: "Beach and café days", when: c => c.styles.has("relaxing") },
  { group: "Tech", label: "Offline maps downloaded", why: "Rural coverage drops out", when: roadtrip },
  { group: "Tech", label: "Car charger / 12V adapter", when: roadtrip },
  { group: "Tech", label: "AUX or USB cable for the rental car", when: roadtrip },

  /* ── Toiletries ── */
  { group: "Toiletries", label: "Toothbrush & toothpaste", when: always },
  { group: "Toiletries", label: "Deodorant", when: always },
  { group: "Toiletries", label: "Travel-size shampoo & conditioner", when: always },
  { group: "Toiletries", label: "Body wash / soap", when: always },
  { group: "Toiletries", label: "Moisturiser", when: always },
  { group: "Toiletries", label: "Rich face cream", why: "Cold air is drying", when: cold },
  { group: "Toiletries", label: "Razor", when: c => c.days >= 3 },
  { group: "Toiletries", label: "Hairbrush / comb", when: always },
  { group: "Toiletries", label: "Nail clippers", when: c => c.days >= 7 },
  { group: "Toiletries", label: "Laundry detergent sheets", why: "Wash and re-wear on longer trips", when: c => c.days >= 10 },

  /* ── Kids (only when travelling with children) ── */
  { group: "Kids", label: "Kids' snacks for transit", when: c => c.withChildren },
  { group: "Kids", label: "Wipes & hand gel", when: c => c.withChildren },
  { group: "Kids", label: "Spare kid outfit in the day bag", why: "Spills happen mid-sightseeing", when: c => c.withChildren },
  { group: "Kids", label: "Kids' water bottles", when: c => c.withChildren },
  { group: "Kids", label: intlLabel("Kids' passports"), when: c => c.withChildren && abroad(c) },
  { group: "Kids", label: "Consent letter (if travelling without the other parent)", why: "Some border agents ask for it", when: c => c.withChildren && abroad(c) },
  // 0–2
  { group: "Kids", label: "Stroller or baby carrier", when: hasBaby },
  { group: "Kids", label: c => `Nappies ×${cap(c.days * 5, 40)}`, why: "~5 per day, buy more there", when: hasBaby },
  { group: "Kids", label: "Formula + bottles", when: hasBaby },
  { group: "Kids", label: "Sterilising tablets / microwave bags", when: hasBaby },
  { group: "Kids", label: "Baby food pouches", when: hasBaby },
  { group: "Kids", label: "Nappy cream", when: hasBaby },
  { group: "Kids", label: "Spare pacifiers ×2", when: hasBaby },
  // 3–6
  { group: "Kids", label: "Kid-sized headphones", when: hasYoungKid },
  { group: "Kids", label: "Activity kit (colouring, stickers)", when: hasYoungKid },
  { group: "Kids", label: "Favourite toy / comfort item", why: "Helps them sleep in a new place", when: hasYoungKid },
  { group: "Kids", label: "Spill-proof cup", when: hasYoungKid },
  // 7–12
  { group: "Kids", label: "Travel games / deck of cards", when: hasKid },
  { group: "Kids", label: "Kid camera", why: "Let them document the trip", when: hasKid },
  { group: "Kids", label: "Book or e-reader for the kids", when: hasKid },
  { group: "Kids", label: "Spare layers for the kids", when: hasKid },
  // 13+
  { group: "Kids", label: "Teen's own charger + headphones", when: hasTeen },
];

/* ── helpers ────────────────────────────────────────────────────────────── */

async function requireMembership(tripId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tripMembers)
    .where(
      and(
        eq(schema.tripMembers.tripId, tripId),
        eq(schema.tripMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this trip" });
  }
  return rows[0];
}

function dateRange(start: string, end: string, max = 30): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (d <= last && out.length < max) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function parseChildAges(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 17);
}

const isSnowCode = (code: number) =>
  (code >= 71 && code <= 77) || code === 85 || code === 86;

function weatherFacts(wx: (DayWeather | null)[]) {
  const days = wx.filter((w): w is DayWeather => !!w);
  const rainy = days.filter(d => d.precipMm >= 3);
  const wet = days.filter(d => d.precipMm >= 1);
  const snow = days.filter(d => isSnowCode(d.code));
  const storm = days.filter(d => d.code >= 95);
  return {
    hasWeather: days.length > 0,
    rainyDays: rainy.length,
    wetDays: wet.length,
    snowDays: snow.length,
    stormDays: storm.length,
    maxT: days.length ? Math.max(...days.map(d => d.tmaxC)) : 22,
    minT: days.length ? Math.min(...days.map(d => d.tminC)) : 14,
    rainLabels: rainy.map(d => weatherLabel(d.code).label),
  };
}

function evaluate(ctx: RuleCtx): PackingGroupOut[] {
  const seen = new Set<string>();
  const groups = new Map<GroupKey, PackingItemOut[]>();
  for (const rule of RULES) {
    let hit = false;
    try {
      hit = rule.when(ctx);
    } catch {
      hit = false; // a broken rule never breaks the list
    }
    if (!hit) continue;
    const label =
      (typeof rule.label === "function" ? rule.label(ctx) : rule.label).trim();
    if (!label || seen.has(label.toLowerCase())) continue; // first rule wins
    seen.add(label.toLowerCase());
    const why =
      typeof rule.why === "function" ? rule.why(ctx) : rule.why;
    const arr = groups.get(rule.group) ?? [];
    arr.push(why ? { label, why } : { label });
    groups.set(rule.group, arr);
  }
  return GROUPS.filter(g => groups.has(g)).map(g => ({
    group: g,
    items: groups.get(g)!,
  }));
}

/** Weather lookup point: centroid of geocoded stops, else geocoded city. */
async function tripAnchor(
  tripId: number,
  destination: string,
): Promise<{ lat: number; lng: number; country: string } | null> {
  const db = getDb();
  const stopRows = await db
    .select({ lat: schema.stops.lat, lng: schema.stops.lng })
    .from(schema.stops)
    .where(eq(schema.stops.tripId, tripId));
  const pts = stopRows.filter(
    (s): s is { lat: number; lng: number } =>
      typeof s.lat === "number" && typeof s.lng === "number",
  );
  // Country always comes from the destination string (stops carry none).
  const geo = await geocodeCity(destination.split(",")[0].trim());
  if (pts.length) {
    const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const lng = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
    return { lat, lng, country: geo?.country ?? "" };
  }
  if (geo) return { lat: geo.lat, lng: geo.lng, country: geo.country };
  return null;
}

/* ── router ─────────────────────────────────────────────────────────────── */

export const packingRouter = createRouter({
  /**
   * Generate (or regenerate) the smart packing list for a trip. Voyager-only.
   * Replaces any previously generated rows; hand-written items are untouched.
   */
  generatePackingList: authedQuery
    .input(z.object({ tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db
        .select()
        .from(schema.trips)
        .where(eq(schema.trips.id, input.tripId))
        .limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });

      // Travel styles from the user's taste profile (same source as the
      // itinerary generator), plus home currency for the abroad heuristic.
      const [prefs] = await db
        .select()
        .from(schema.preferences)
        .where(eq(schema.preferences.userId, ctx.user.id))
        .limit(1);

      const dates = dateRange(trip.startDate, trip.endDate);
      const anchor = await tripAnchor(input.tripId, trip.destination);
      // Per-day weather - capped at 14 lookups; the rules only need extremes.
      const wx = anchor
        ? await Promise.all(
            dates.slice(0, 14).map(d => getDayWeather(anchor.lat, anchor.lng, d)),
          )
        : [];
      const facts = weatherFacts(wx);

      const country = anchor?.country ?? "";
      const homeGuess =
        CURRENCY_COUNTRY[prefs?.homeCurrency ?? trip.homeCurrency] ?? null;
      const international: boolean | null = !country
        ? null
        : homeGuess === "Eurozone"
          ? !EUROZONE.has(country)
          : homeGuess
            ? country !== homeGuess
            : null;

      const ruleCtx: RuleCtx = {
        days: dates.length,
        country,
        homeCountry: homeGuess === "Eurozone" ? "" : (homeGuess ?? ""),
        destination: trip.destination,
        international,
        tripType: trip.tripType ?? "city",
        styles: new Set(prefs?.styles ?? []),
        withChildren: !!trip.withChildren,
        childAges: parseChildAges(trip.childAges),
        ...facts,
      };
      const groups = evaluate(ruleCtx);

      // Replace previously generated rows only - manual items stay put.
      const deleted = await db
        .delete(schema.checklistItems)
        .where(
          and(
            eq(schema.checklistItems.tripId, input.tripId),
            eq(schema.checklistItems.list, "packing"),
            like(schema.checklistItems.label, `${GENERATED_PREFIX}%`),
          ),
        );
      const replaced = Number(
        (deleted as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0,
      );

      const remaining = await db
        .select({ position: schema.checklistItems.position })
        .from(schema.checklistItems)
        .where(
          and(
            eq(schema.checklistItems.tripId, input.tripId),
            eq(schema.checklistItems.list, "packing"),
          ),
        );
      let pos = remaining.reduce((m, r) => Math.max(m, r.position), -1) + 1;
      // Persisted label carries group + why as pipe-separated fields after the
      // "✦ " marker (schema has no metadata column): "✦ Group|Label|Why?".
      // The UI strips all of this from display; deletes match on the prefix.
      const rows = groups.flatMap(g =>
        g.items.map(item => ({
          tripId: input.tripId,
          list: "packing",
          label:
            GENERATED_PREFIX +
            g.group +
            "|" +
            item.label +
            (item.why ? "|" + item.why : ""),
          done: false,
          position: pos++,
        })),
      );
      if (rows.length) await db.insert(schema.checklistItems).values(rows);

      return {
        groups,
        inserted: rows.length,
        replaced,
        meta: {
          days: dates.length,
          country: country || null,
          international,
          weatherKnown: facts.hasWeather,
          summary: facts.hasWeather
            ? `${Math.round(facts.minT)}–${Math.round(facts.maxT)}°C` +
              (facts.rainyDays
                ? ` · ${facts.rainyDays} rainy day${facts.rainyDays > 1 ? "s" : ""}`
                : "") +
              (facts.snowDays ? " · snow" : "")
            : null,
        },
      };
    }),

  /** Remove all generated packing rows for a trip (manual items stay). */
  clearGenerated: authedQuery
    .input(z.object({ tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const res = await db
        .delete(schema.checklistItems)
        .where(
          and(
            eq(schema.checklistItems.tripId, input.tripId),
            eq(schema.checklistItems.list, "packing"),
            like(schema.checklistItems.label, `${GENERATED_PREFIX}%`),
          ),
        );
      return {
        deleted: Number(
          (res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0,
        ),
      };
    }),
});
