/**
 * Bengaluru getaways seed (r13-getaways) - curated starters for the
 * "Getaways - within ~2 hours" feature: the classic small hikes, falls and
 * heritage drives within ~150 km of Bengaluru (Nandi Hills, Skandagiri,
 * Savandurga, Shivanasamudra, Lepakshi, …).
 *
 * Each entry is geocoded via Photon (geocodeCityInCountry(name, 'India');
 * hardcoded fallback coords keep the seed working when Photon can't resolve
 * a local name), then inserted into explore_places when no same-named row
 * exists within ~11 km (idempotent). Afterwards the live Overpass getaway
 * enrichment runs once for Bengaluru (enrichCityGetaways - peaks, falls,
 * viewpoints, reserves, forts/ruins, hiking routes within 120 km).
 *
 * Run:  npx tsx db/seed-getaways-bengaluru.ts
 */
import { and, gte, lte } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../api/queries/connection";
import { geocodeCityInCountry } from "../api/queries/overpass";
import { kmBetween, radiusBbox } from "../api/queries/coverage";
import { enrichCityGetaways } from "../api/getaways-router";

interface CuratedGetaway {
  name: string;
  /** Fallback coords when Photon can't resolve the local name. */
  lat: number;
  lng: number;
  category: "natural" | "historic" | "adventure";
  tags: string[];
  rating: number;
  blurb: string;
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The classic ~2-hour circuit out of Bengaluru. */
export const BENGALURU_GETAWAYS: CuratedGetaway[] = [
  {
    name: "Nandi Hills",
    lat: 13.3702, lng: 77.6835,
    category: "natural",
    tags: ["peak", "viewpoint", "hike", "sunrise"],
    rating: 4.6,
    blurb: "Bengaluru's classic sunrise drive, a 1,478 m hillfort with misty viewpoints, Tipu's Drop and an easy walking trail at the top.",
  },
  {
    name: "Skandagiri",
    lat: 13.4247, lng: 77.6823,
    category: "adventure",
    tags: ["hike", "peak", "sunrise", "trail"],
    rating: 4.5,
    blurb: "Night-trek favourite near Chikkaballapur, a moderate 8 km trail to a ruined hill fort above a sea of clouds.",
  },
  {
    name: "Savandurga",
    lat: 12.9197, lng: 77.2927,
    category: "natural",
    tags: ["peak", "hike", "monolith"],
    rating: 4.5,
    blurb: "One of Asia's largest monolith hills, a steep half-day climb with wide reservoir views, 60 km west of the city.",
  },
  {
    name: "Ramanagara",
    lat: 12.721, lng: 77.281,
    category: "adventure",
    tags: ["peak", "hike", "climb"],
    rating: 4.4,
    blurb: "The granite crags of 'Sholay' fame. Ramadevarabetta and neighbouring hills are the closest real rock climbing to Bengaluru.",
  },
  {
    name: "Anthargange",
    lat: 13.1377, lng: 78.1072,
    category: "adventure",
    tags: ["caves", "hike", "peak"],
    rating: 4.4,
    blurb: "Volcanic boulder caves and a short scramble above Kolar, cave exploration plus a sunrise viewpoint in one trip.",
  },
  {
    name: "Makalidurga",
    lat: 13.436, lng: 77.508,
    category: "adventure",
    tags: ["hike", "fort", "peak", "trail"],
    rating: 4.4,
    blurb: "A railway-side trail climbing to a small hilltop fort with a temple and views over Gunjar Lake.",
  },
  {
    name: "Avalabetta",
    lat: 13.5692, lng: 77.5333,
    category: "natural",
    tags: ["peak", "viewpoint", "hike"],
    rating: 4.4,
    blurb: "Nandi Hills' quieter neighbour, a short climb to the famous cliff-edge 'beak rock' viewpoint.",
  },
  {
    name: "Devarayanadurga",
    lat: 13.3696, lng: 77.2128,
    category: "natural",
    tags: ["peak", "viewpoint", "temple", "hike"],
    rating: 4.5,
    blurb: "Forest-reserve hill near Tumakuru with twin temple summits, hairpin-drive viewpoints and a breeze all year.",
  },
  {
    name: "Chunchi Falls",
    lat: 12.31, lng: 77.57,
    category: "natural",
    tags: ["waterfall", "nature"],
    rating: null, // r25: OSM import, no real rating available
    blurb: "The Arkavati river drops 15 m into a rocky gorge near Kanakapura, best right after the monsoon.",
  },
  {
    name: "Mekedatu",
    lat: 12.26, lng: 77.45,
    category: "natural",
    tags: ["gorge", "nature", "viewpoint"],
    rating: 4.4,
    blurb: "'Goat's leap', the Kaveri squeezes through a narrow granite gorge past the Sangama confluence near Kanakapura.",
  },
  {
    name: "Shivanasamudra Falls",
    lat: 12.2953, lng: 77.1699,
    category: "natural",
    tags: ["waterfall", "nature", "viewpoint"],
    rating: 4.6,
    blurb: "The Kaveri splits into the twin Gaganachukki and Bharachukki falls. Karnataka's grandest monsoon spectacle.",
  },
  {
    name: "Lepakshi",
    lat: 13.8044, lng: 77.6083,
    category: "historic",
    tags: ["heritage", "historic", "temple"],
    rating: 4.6,
    blurb: "Vijayanagara-era Veerabhadra temple with the hanging pillar, giant Nandi and faded ceiling murals, just across the AP border.",
  },
  {
    name: "Bheemeshwari",
    lat: 12.325, lng: 77.285,
    category: "natural",
    tags: ["nature", "river", "sanctuary"],
    rating: 4.4,
    blurb: "Kaveri river camp inside the Cauvery wildlife sanctuary, coracle rides, mahseer waters and forest drives.",
  },
  {
    name: "Bilikal Rangaswamy Betta",
    lat: 12.3717, lng: 77.5344,
    category: "adventure",
    tags: ["hike", "peak", "hill", "trail"],
    rating: 4.4,
    blurb: "A breezy 3,780 ft hill near Kanakapura with a small summit temple, one of the best easy treks south of the city.",
  },
  {
    name: "Kunti Betta",
    lat: 12.7258, lng: 76.6726,
    category: "adventure",
    tags: ["hike", "peak", "hill", "sunrise"],
    rating: 4.4,
    blurb: "Twin rocky hillocks near Pandavapura, Mahabharata lore attached, a short, steep sunrise climb off the Mysuru road.",
  },
];

/** Insert one curated getaway when no same-named row sits within ~11 km. */
async function upsertGetaway(g: CuratedGetaway): Promise<"inserted" | "exists" | "failed"> {
  try {
    const geo = await geocodeCityInCountry(g.name, "India");
    // Distrust geocodes that land implausibly far from the curated coords - 
    // Photon happily resolves "Skandagiri" to a same-named locality 500 km
    // away near Hyderabad.
    const plausible = geo != null && kmBetween(g.lat, g.lng, geo.lat, geo.lng) <= 150;
    const lat = plausible ? geo!.lat : g.lat;
    const lng = plausible ? geo!.lng : g.lng;
    const db = getDb();
    const b = radiusBbox(lat, lng, 11);
    const nearby = await db
      .select({ name: schema.explorePlaces.name, lat: schema.explorePlaces.lat, lng: schema.explorePlaces.lng })
      .from(schema.explorePlaces)
      .where(
        and(
          gte(schema.explorePlaces.lat, b.s),
          lte(schema.explorePlaces.lat, b.n),
          gte(schema.explorePlaces.lng, b.w),
          lte(schema.explorePlaces.lng, b.e),
        ),
      );
    const key = normName(g.name);
    const dupe = nearby.some(
      (r) =>
        normName(r.name) === key &&
        r.lat != null &&
        r.lng != null &&
        kmBetween(lat, lng, r.lat, r.lng) <= 11,
    );
    if (dupe) return "exists";
    await db.insert(schema.explorePlaces).values({
      name: g.name,
      osmId: null,
      source: "curated",
      city: plausible ? (geo!.name ?? g.name) : g.name,
      country: geo?.country ?? "India",
      category: g.category,
      tags: g.tags,
      styles: g.category === "historic" ? ["historical"] : ["adventure"],
      rating: g.rating,
      priceLevel: 2,
      feeCents: null,
      feeCurrency: null,
      feeNote: null,
      description: g.blurb,
      hidden: false,
      image: null,
      lat,
      lng,
      approved: true,
    });
    return "inserted";
  } catch (e) {
    console.error(`  [seed-getaways] ${g.name} · FAILED: ${e instanceof Error ? e.message : e}`);
    return "failed";
  }
}

const startedAt = Date.now();
console.log(`[seed-getaways] Bengaluru wave, ${BENGALURU_GETAWAYS.length} curated getaways`);
let inserted = 0;
let existing = 0;
let failed = 0;
for (const g of BENGALURU_GETAWAYS) {
  const res = await upsertGetaway(g);
  if (res === "inserted") inserted++;
  else if (res === "exists") existing++;
  else failed++;
  console.log(`  [seed-getaways] ${g.name}, ${res}`);
}
console.log(
  `[seed-getaways] curated done, +${inserted} inserted, ${existing} already present, ${failed} failed`,
);

// Live Overpass enrichment once for Bengaluru (24 h api_cache marker inside).
try {
  const res = await enrichCityGetaways("Bengaluru");
  console.log(
    `[seed-getaways] Overpass enrichment, fetched ${res.fetched} elements, inserted +${res.inserted}`,
  );
} catch (e) {
  console.error(
    `[seed-getaways] Overpass enrichment failed (curated rows are already in): ${e instanceof Error ? e.message : e}`,
  );
}

console.log(`[seed-getaways] DONE in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
