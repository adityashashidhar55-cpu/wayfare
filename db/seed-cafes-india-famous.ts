/**
 * seed-cafes-india-famous.ts (r16-india) - curated famous-café wave for the
 * big Indian cities: genuinely famous / Instagram-grade cafés and coffee
 * institutions (MTR, Vidyarthi Bhavan, Leopold, Indian Coffee House College
 * Street, Flurys, Café Niloufer, Kashi Art Café, …).
 *
 * Every candidate is VERIFIED by a Photon search ("<name>, <city>, India",
 * 1 req/s, results filtered to countrycode IN) using the same confident-name
 * rule as db/audit-india-locations.ts; the verified Photon coords are what
 * gets stored. Candidates Photon can't verify are skipped.
 *
 * Insert shape: category='food', tags ['cafe', …dish/history tags],
 * styles [], rating 4.4–4.7 (curator judgment), famousEatery=1,
 * source='curated', country='India', city = canonical corpus city string.
 *
 * Idempotent: a same-normalized-name row within 1 km (any India city) is
 * treated as the same place and skipped.
 *
 * Photos: after the wave, all newly inserted rows go through the r13
 * DBpedia photo path (dbpediaPhotosForBatch from db/seed-photos.ts) - 
 * cafés with a Wikipedia page (MTR, Leopold, Flurys, Indian Coffee House, …)
 * get their real photo; the rest stay image-less for the generic backfill.
 *
 * Run:  npx tsx db/seed-cafes-india-famous.ts [--dry-run]
 */
import { eq, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet, kmBetween } from "../api/queries/coverage";
import { fetchJson } from "../api/lib/http";
import type { PhotonResponse } from "../api/queries/overpass";
import { dbpediaPhotosForBatch } from "./seed-photos";

const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; india famous cafes; +https://wayfare.app)";
const PHOTON_MIN_INTERVAL_MS = 1000;
const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DRY_RUN = process.argv.includes("--dry-run");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface Cafe {
  name: string; // display name
  search?: string; // Photon query override when the display name is ambiguous
  match?: string[]; // extra normalized substrings that also prove the Photon hit
  city: string; // canonical corpus city string
  rating: number;
  tags: string[];
  blurb: string;
}

/** City centers + guard radius (km) - a Photon hit farther than this is the
 * wrong place (e.g. "Roastery Coffee House, Hyderabad" matching in UP). */
const CITY_CENTERS: Record<string, { lat: number; lng: number; km: number }> = {
  Bengaluru: { lat: 12.9716, lng: 77.5946, km: 60 },
  Mumbai: { lat: 19.076, lng: 72.8777, km: 60 },
  Delhi: { lat: 28.6139, lng: 77.209, km: 60 },
  Jaipur: { lat: 26.9124, lng: 75.7873, km: 60 },
  Goa: { lat: 15.4909, lng: 73.8278, km: 85 },
  Kochi: { lat: 9.9312, lng: 76.2673, km: 60 },
  Chennai: { lat: 13.0827, lng: 80.2707, km: 60 },
  Hyderabad: { lat: 17.385, lng: 78.4867, km: 60 },
  Kolkata: { lat: 22.5726, lng: 88.3639, km: 60 },
};

const CAFES: Cafe[] = [
  // ── Bengaluru ─────────────────────────────────────────────────────────
  { name: "Mavalli Tiffin Room (MTR)", search: "MTR Mavalli Tiffin Rooms Lalbagh", city: "Bengaluru", rating: 4.7, tags: ["cafe", "filter-coffee", "masala-dosa", "heritage", "breakfast"], blurb: "The 1924 tiffin-room institution that codified Bengaluru breakfast." },
  { name: "Vidyarthi Bhavan", city: "Bengaluru", rating: 4.6, tags: ["cafe", "masala-dosa", "heritage", "breakfast"], blurb: "Basavanagudi's 1943 dosa hall, crisp benne dosas, shared tables." },
  { name: "Brahmin's Coffee Bar", city: "Bengaluru", rating: 4.5, tags: ["cafe", "filter-coffee", "idli", "heritage"], blurb: "Shankarpuram's tiny 1965 counter, idli-vada and lethal filter coffee." },
  { name: "CTR (Central Tiffin Room)", search: "CTR Shri Sagar, Malleshwaram, Bengaluru", match: ["ctr"], city: "Bengaluru", rating: 4.5, tags: ["cafe", "benne-dosa", "heritage", "breakfast"], blurb: "Malleshwaram's benne-dosa benchmark since the 1920s." },
  { name: "Veena Stores", city: "Bengaluru", rating: 4.5, tags: ["cafe", "idli", "filter-coffee", "breakfast"], blurb: "Margosa Road's standing-room idli legend." },
  { name: "Third Wave Coffee Roasters", search: "Third Wave Coffee Koramangala", city: "Bengaluru", rating: 4.4, tags: ["cafe", "specialty-coffee", "espresso"], blurb: "The Koramangala roastery that kicked off India's third-wave scene." },
  { name: "Blue Tokai Coffee Roasters", search: "Blue Tokai Coffee Indiranagar", city: "Bengaluru", rating: 4.4, tags: ["cafe", "specialty-coffee", "roastery"], blurb: "Indiranagar outpost of India's estate-to-cup specialty pioneer." },
  { name: "Matteo Coffea", search: "Matteo Coffea, Church Street, Bengaluru", match: ["matteo"], city: "Bengaluru", rating: 4.4, tags: ["cafe", "espresso", "church-street"], blurb: "Church Street's perennially packed espresso hangout." },
  { name: "Dyu Art Cafe", city: "Bengaluru", rating: 4.5, tags: ["cafe", "art", "kerala-style", "garden"], blurb: "Koramangala's old-Kerala-house art café around a plant-filled courtyard." },
  { name: "Indian Coffee House", search: "Indian Coffee House Church Street Bangalore", city: "Bengaluru", rating: 4.4, tags: ["cafe", "filter-coffee", "heritage"], blurb: "Church Street's old-school worker-cooperative coffee house." },
  // ── Mumbai ────────────────────────────────────────────────────────────
  { name: "Kala Ghoda Café", city: "Mumbai", rating: 4.5, tags: ["cafe", "art-district", "brunch"], blurb: "Fort's tiny design-district café in a restored heritage barn." },
  { name: "Leopold Cafe", city: "Mumbai", rating: 4.5, tags: ["cafe", "heritage", "colaba", "irani"], blurb: "Colaba's 1871 Irani café-bar, bullet-pocked and beloved." },
  { name: "Cafe Mondegar", city: "Mumbai", rating: 4.5, tags: ["cafe", "heritage", "colaba", "jukebox"], blurb: "Colaba's Mario Miranda-muraled institution since 1871." },
  { name: "K Rustom Ice Cream", search: "K. Rustom & Co., Churchgate, Mumbai", match: ["k rustom"], city: "Mumbai", rating: 4.6, tags: ["cafe", "ice-cream-sandwich", "heritage"], blurb: "Churchgate's 1953 ice-cream-sandwich institution." },
  { name: "Prithvi Café", city: "Mumbai", rating: 4.5, tags: ["cafe", "theatre", "juhu", "irish-coffee"], blurb: "The leafy theatre café attached to Prithvi Theatre, Juhu." },
  { name: "Blue Tokai Coffee Roasters", search: "Blue Tokai Coffee, Khar West, Mumbai", city: "Mumbai", rating: 4.4, tags: ["cafe", "specialty-coffee", "roastery"], blurb: "Bandra outpost of India's estate-to-cup specialty pioneer." },
  { name: "The Pantry", search: "The Pantry, Kala Ghoda, Mumbai", match: ["pantry"], city: "Mumbai", rating: 4.4, tags: ["cafe", "brunch", "kala-ghoda"], blurb: "Kala Ghoda's airy all-day brunch café." },
  { name: "Candies", search: "Candies Cafe Bandra Mumbai", city: "Mumbai", rating: 4.4, tags: ["cafe", "bandra", "desserts"], blurb: "Bandra's rambling multi-level café beloved of college kids and ad folk." },
  // ── Delhi ─────────────────────────────────────────────────────────────
  { name: "Khan Chacha", city: "Delhi", rating: 4.5, tags: ["cafe", "kebab-rolls", "khan-market", "heritage"], blurb: "Khan Market's 1972 kebab-roll legend." },
  { name: "Indian Coffee House", search: "Indian Coffee House Connaught Place Delhi", city: "Delhi", rating: 4.5, tags: ["cafe", "filter-coffee", "heritage"], blurb: "The Connaught Place terrace coffee house. Delhi's adda since 1957." },
  { name: "Choko La", city: "Delhi", rating: 4.4, tags: ["cafe", "chocolate", "desserts", "khan-market"], blurb: "Khan Market's couverture-chocolate café." },
  { name: "Kunzum Travel Café", city: "Delhi", rating: 4.5, tags: ["cafe", "travel", "pay-what-you-like", "hauz-khas"], blurb: "Hauz Khas Village's pay-what-you-like travel café." },
  { name: "Cafe Tesu", city: "Delhi", rating: 4.4, tags: ["cafe", "specialty-coffee", "saket"], blurb: "Saket's light-filled specialty coffee and brunch spot." },
  { name: "The Big Chill Cafe", city: "Delhi", rating: 4.5, tags: ["cafe", "desserts", "khan-market"], blurb: "Khan Market's movie-poster-lined café. Delhi's dessert benchmark." },
  { name: "United Coffee House", search: "United Coffee House, Connaught Place, New Delhi", city: "Delhi", rating: 4.4, tags: ["cafe", "heritage", "connaught-place"], blurb: "Connaught Place's chandeliered 1942 coffee house." },
  // ── Jaipur ────────────────────────────────────────────────────────────
  { name: "Tapri Central", city: "Jaipur", rating: 4.5, tags: ["cafe", "chai", "rooftop"], blurb: "Jaipur's beloved rooftop chai house overlooking Central Park." },
  { name: "Curious Life Coffee Roasters", city: "Jaipur", rating: 4.5, tags: ["cafe", "specialty-coffee", "roastery"], blurb: "Jaipur's original specialty roaster on C-Scheme's Prithviraj Road." },
  { name: "Bar Palladio", city: "Jaipur", rating: 4.6, tags: ["cafe", "design", "mughal-garden", "evening"], blurb: "The cobalt-blue Mughal-fantasia bar-café at Narain Niwas." },
  { name: "Anokhi Café", city: "Jaipur", rating: 4.4, tags: ["cafe", "organic", "brunch"], blurb: "The block-print brand's farm-fresh café, salads, cakes, good coffee." },
  { name: "Nibs Café & Chocolataria", search: "Nibs Cafe, Jaipur", match: ["nibs"], city: "Jaipur", rating: 4.4, tags: ["cafe", "chocolate", "desserts"], blurb: "Jaipur's bean-to-bar chocolate café." },
  // ── Goa ───────────────────────────────────────────────────────────────
  { name: "Café Bodega", city: "Goa", rating: 4.5, tags: ["cafe", "art", "altinho", "brunch"], blurb: "Panjim's whitewashed art-gallery café in the Altinho hills." },
  { name: "Infantaria", city: "Goa", rating: 4.4, tags: ["cafe", "bakery", "calangute", "breakfast"], blurb: "Calangute's 1980s bakery-café, croissants, prawn patties, bebinca." },
  { name: "Artjuna", city: "Goa", rating: 4.5, tags: ["cafe", "garden", "anjuna", "healthy"], blurb: "Anjuna's garden café-lifestyle store under the mango trees." },
  { name: "Bomboocha", city: "Goa", rating: 4.4, tags: ["cafe", "kombucha", "assagao"], blurb: "Assagao's kombucha-and-coffee hideout in a Goan villa." },
  { name: "Baba Au Rhum", city: "Goa", rating: 4.5, tags: ["cafe", "french-bakery", "anjuna"], blurb: "Anjuna's French bakery-café, croissants, pâtisserie, jungle views." },
  { name: "German Bakery", search: "German Bakery Anjuna Goa", city: "Goa", rating: 4.4, tags: ["cafe", "bakery", "anjuna", "healthy"], blurb: "Anjuna's long-running health-food bakery café." },
  // ── Kochi ─────────────────────────────────────────────────────────────
  { name: "Kashi Art Café", city: "Kochi", rating: 4.6, tags: ["cafe", "art", "fort-kochi", "garden"], blurb: "Fort Kochi's pioneering art café, chocolate cake and installations." },
  { name: "Mocha Art Café", city: "Kochi", rating: 4.5, tags: ["cafe", "heritage", "fort-kochi"], blurb: "The 300-year-old Dutch mansion café by the Santa Cruz Basilica." },
  { name: "Loafer's Corner Café", search: "Loafers Corner, Fort Kochi, Kochi", match: ["loafers corner"], city: "Kochi", rating: 4.4, tags: ["cafe", "fort-kochi", "books"], blurb: "Princess Street's lazy-corner café for coffee and people-watching." },
  { name: "Qissa Café", city: "Kochi", rating: 4.5, tags: ["cafe", "fort-kochi", "garden", "breakfast"], blurb: "Fort Kochi's courtyard café, shakshuka, cakes, slow mornings." },
  { name: "Pepper House Café", city: "Kochi", rating: 4.4, tags: ["cafe", "heritage", "fort-kochi", "waterfront"], blurb: "The Biennale precinct's godown café on the waterfront." },
  // ── Chennai ───────────────────────────────────────────────────────────
  { name: "Ratna Café", search: "Ratna Cafe, Triplicane, Chennai", city: "Chennai", rating: 4.5, tags: ["cafe", "idli", "sambar", "heritage", "breakfast"], blurb: "Triplicane's 1948 idli-sambar institution." },
  { name: "Writer's Café", city: "Chennai", rating: 4.5, tags: ["cafe", "books", "gopalapuram"], blurb: "Gopalapuram's book-lined café run with burn-survivor trainees." },
  { name: "Chamiers Café", city: "Chennai", rating: 4.4, tags: ["cafe", "brunch", "alwarpet"], blurb: "Alwarpet's garden-villa café beside the Amethyst boutique." },
  { name: "Amethyst Café", search: "Amethyst Cafe Chennai", city: "Chennai", rating: 4.5, tags: ["cafe", "heritage", "garden", "royapettah"], blurb: "Royapettah's bougainvillea-draped mansion café." },
  { name: "Madras Coffee House", city: "Chennai", rating: 4.4, tags: ["cafe", "filter-coffee", "heritage"], blurb: "Old-Madras-style filter-coffee house for a proper degree kaapi." },
  // ── Hyderabad ─────────────────────────────────────────────────────────
  { name: "Café Niloufer", city: "Hyderabad", rating: 4.6, tags: ["cafe", "irani-chai", "osmania-biscuit", "heritage"], blurb: "Lakdi-ka-pul's legendary Irani chai house, malai bun and Osmania biscuits." },
  { name: "Roastery Coffee House", search: "Roastery Coffee House, Banjara Hills, Hyderabad", city: "Hyderabad", rating: 4.5, tags: ["cafe", "specialty-coffee", "roastery", "banjara-hills"], blurb: "Banjara Hills' bungalow roastery that started Hyderabad's third wave." },
  { name: "Autumn Leaf Café", city: "Hyderabad", rating: 4.4, tags: ["cafe", "jubilee-hills", "brunch"], blurb: "Jubilee Hills' leafy bungalow café." },
  { name: "Nimrah Café & Bakery", search: "Nimrah Cafe, Charminar, Hyderabad", match: ["nimrah"], city: "Hyderabad", rating: 4.5, tags: ["cafe", "irani-chai", "charminar", "heritage"], blurb: "The Charminar-steps Irani café, chai and Osmania biscuits since 1993." },
  // ── Kolkata ───────────────────────────────────────────────────────────
  { name: "Indian Coffee House", search: "Indian Coffee House College Street Kolkata", city: "Kolkata", rating: 4.6, tags: ["cafe", "adda", "heritage", "college-street"], blurb: "College Street's smoky adda hall, the intellectual heart of Kolkata." },
  { name: "Flurys", search: "Flurys, Park Street, Kolkata", match: ["flury"], city: "Kolkata", rating: 4.5, tags: ["cafe", "tea-room", "park-street", "heritage"], blurb: "Park Street's 1927 Swiss tearoom, rum balls and English breakfast." },
  { name: "8th Day Café & Bakery", city: "Kolkata", rating: 4.5, tags: ["cafe", "bakery", "specialty-coffee"], blurb: "Kolkata's community-bakery café, cinnamon rolls and pour-overs." },
  { name: "Blue Sky Café", city: "Kolkata", rating: 4.4, tags: ["cafe", "sudder-street", "backpacker"], blurb: "Sudder Street's backpacker café, pancakes and travel tales." },
  { name: "Roastery Coffee House", search: "Roastery Coffee House Kolkata", city: "Kolkata", rating: 4.4, tags: ["cafe", "specialty-coffee", "southern-avenue"], blurb: "Southern Avenue's bungalow specialty roaster." },
];

let lastPhotonAt = 0;

interface Verified {
  lat: number;
  lng: number;
  photonName: string;
}

/** Photon-verify (1 req/s, India-filtered, city-radius guarded). */
async function verifyPhoton(cafe: Cafe): Promise<Verified | null> {
  const query = `${cafe.search ?? cafe.name}, ${cafe.city}, India`;
  const key = `geo:cafeindia2:${norm(query)}`;
  const cached = await cacheGet<{ hit: Verified | null }>(key);
  if (cached) return cached.hit;
  const wait = PHOTON_MIN_INTERVAL_MS - (Date.now() - lastPhotonAt);
  if (wait > 0) await sleep(wait);
  lastPhotonAt = Date.now();
  const center = CITY_CENTERS[cafe.city];
  let hit: Verified | null = null;
  try {
    const url = new URL(PHOTON_API);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");
    url.searchParams.set("lang", "en");
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 8000,
      userAgent: USER_AGENT,
      service: "photon",
    });
    const stripped = norm(cafe.name.replace(/\([^)]*\)/g, " ")); // "(MTR)" shouldn't block the match
    const full = norm(cafe.name);
    const extra = (cafe.match ?? []).map((m) => norm(m)).filter((m) => m.length >= 3);
    for (const f of data.features ?? []) {
      const p = f.properties;
      if ((p.countrycode ?? "").toUpperCase() !== "IN") continue;
      const hn = norm(p.name ?? "");
      if (hn.length < 3) continue;
      // Confident: name containment against the display/stripped form, or a
      // curator-supplied match token ("ctr", "flury", "loafers corner"…).
      const containment = [stripped, full].some(
        (c) => c.length >= 3 && (hn === c || hn.startsWith(c) || hn.includes(c) || c.includes(hn)),
      );
      const tokenHit = extra.some((m) => hn.includes(m));
      if (!containment && !tokenHit) continue;
      const [lng, lat] = f.geometry.coordinates;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      // City-radius guard - the right name in the wrong city is the wrong place.
      if (center && kmBetween(center.lat, center.lng, lat, lng) > center.km) continue;
      hit = { lat, lng, photonName: (p.name ?? "").trim() };
      break;
    }
  } catch (e) {
    console.warn(`[cafes] photon error for "${query}": ${e instanceof Error ? e.message : e}`);
    await sleep(2000);
    return null; // not cached - retry next run
  }
  await cacheSet(key, { hit }, GEO_TTL_MS);
  return hit;
}

async function main() {
  const db = getDb();
  // Existing India rows for the 1 km same-name dedupe.
  const existing = await db
    .select({
      id: schema.explorePlaces.id,
      name: schema.explorePlaces.name,
      city: schema.explorePlaces.city,
      lat: schema.explorePlaces.lat,
      lng: schema.explorePlaces.lng,
    })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.country, "India"));
  const existingByNorm = new Map<string, { city: string; lat: number | null; lng: number | null }[]>();
  for (const r of existing) {
    const k = norm(r.name);
    const g = existingByNorm.get(k) ?? [];
    g.push({ city: r.city, lat: r.lat, lng: r.lng });
    existingByNorm.set(k, g);
  }

  let inserted = 0;
  let skippedDup = 0;
  let skippedUnverified = 0;
  const perCity = new Map<string, number>();
  const newRows: { id: number; name: string; city: string }[] = [];

  for (const cafe of CAFES) {
    const hit = await verifyPhoton(cafe);
    if (!hit) {
      console.warn(`[cafes] SKIP (unverified): ${cafe.name} (${cafe.city})`);
      skippedUnverified++;
      continue;
    }
    // Idempotency: same normalized name within 1 km already in the corpus?
    const near = (existingByNorm.get(norm(cafe.name)) ?? []).some(
      (r) => r.lat != null && r.lng != null && kmBetween(r.lat, r.lng, hit.lat, hit.lng) <= 1,
    );
    if (near) {
      console.log(`[cafes] SKIP (exists ≤1km): ${cafe.name} (${cafe.city})`);
      skippedDup++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`[cafes] DRY would insert: ${cafe.name} (${cafe.city}) @ ${hit.lat},${hit.lng}`);
      continue;
    }
    const res = await db.insert(schema.explorePlaces).values({
      name: cafe.name,
      city: cafe.city,
      country: "India",
      lat: hit.lat,
      lng: hit.lng,
      category: "food",
      tags: cafe.tags,
      styles: [],
      rating: cafe.rating,
      priceLevel: 2,
      description: cafe.blurb,
      source: "curated",
      famousEatery: true,
    });
    const insertId = Number((res as unknown as [{ insertId: number | string }])[0]?.insertId ?? 0);
    if (insertId) newRows.push({ id: insertId, name: cafe.name, city: cafe.city });
    inserted++;
    perCity.set(cafe.city, (perCity.get(cafe.city) ?? 0) + 1);
    console.log(`[cafes] INSERT ${cafe.name} (${cafe.city}) @ ${hit.lat},${hit.lng}`);
  }

  // Photos for cafés that have Wikipedia/DBpedia coverage.
  if (!DRY_RUN && newRows.length > 0) {
    try {
      const hits = await dbpediaPhotosForBatch(newRows);
      for (const [id, hit] of hits) {
        await db
          .update(schema.explorePlaces)
          .set({ image: hit.image, photoSource: "wikipedia", photoAttribution: hit.attribution })
          .where(eq(schema.explorePlaces.id, id));
        console.log(`[cafes] PHOTO ${newRows.find((r) => r.id === id)?.name}: ${hit.title}`);
      }
      console.log(`[cafes] photos attached: ${hits.size}/${newRows.length}`);
    } catch (e) {
      console.warn(`[cafes] photo pass failed (backfill will catch up): ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `\n[cafes] done: ${inserted} inserted, ${skippedDup} already present, ${skippedUnverified} unverified`,
  );
  console.log("[cafes] inserted per city:");
  for (const [city, n] of perCity) console.log(`  ${city}: ${n}`);
  const total = await db.execute(
    sql`SELECT city, COUNT(*) n FROM explore_places WHERE country='India' AND famousEatery=1 GROUP BY city ORDER BY n DESC`,
  );
  console.log("[cafes] famousEatery totals:", JSON.stringify((total as unknown as unknown[])[0]));
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[cafes] FAILED:", e);
    process.exit(1);
  });
}
