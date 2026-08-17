/**
 * verify-signature-dishes.ts (r16-india) - Photon-verifies every place in
 * db/data/signature-dishes-india.json (the contract file for the signature-
 * dishes feature) using the same flow as db/seed-cafes-india-famous.ts:
 * "<name>, <city>, India" at 1 req/s, India-filtered, city-radius guarded,
 * confident name match. Verified hits REPLACE the stored coords (canonical
 * OSM position); places Photon can't verify are DROPPED from the JSON (a
 * dish keeps whatever places verified; dishes left with zero places are
 * dropped too - the JSON only ever contains verified data).
 *
 * Results are cached 30d in api_cache (geo:dishindia:) so re-runs are fast.
 *
 * Run:  npx tsx db/verify-signature-dishes.ts [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cacheGet, cacheSet, kmBetween } from "../api/queries/coverage";
import { fetchJson } from "../api/lib/http";
import type { PhotonResponse } from "../api/queries/overpass";

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(HERE, "data", "signature-dishes-india.json");
const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; india dish-place verification; +https://wayfare.app)";
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
  Agra: { lat: 27.1767, lng: 78.0081, km: 60 },
};

interface DishPlace {
  name: string;
  lat: number;
  lng: number;
  why: string;
}
interface Dish {
  city: string;
  country: string;
  dish: string;
  blurb: string;
  places: DishPlace[];
}

let lastPhotonAt = 0;

/**
 * Curator overrides keyed `norm(name)|City`:
 *  - q/match: query Photon with a locality-qualified search and extra
 *    normalized substrings that prove the hit (branch-heavy or
 *    variant-spelled names).
 *  - coords: skip Photon - the stall isn't in OSM (Aaram Vada Pav CST,
 *    the Vivekananda Park phuchka cart); coords are curator-placed at the
 *    documented landmark. K.C. Das uses the corpus' own OSM row
 *    ("KC Das Sweet Shop", Esplanade).
 */
const OVERRIDES: Record<string, { q?: string; match?: string[]; coords?: [number, number] }> = {
  "aaram vada pav|Mumbai": { coords: [18.9398, 72.8355] },
  "moti mahal delux|Delhi": { q: "Moti Mahal, Daryaganj, Delhi", match: ["moti mahal"] },
  "gulati|Delhi": { q: "Gulati, Pandara Road, Delhi", match: ["gulati"] },
  "paradise biryani|Hyderabad": { q: "Paradise, Secunderabad, Hyderabad", match: ["paradise"] },
  "cafe niloufer|Hyderabad": { q: "Cafe Niloufer, Lakdikapul, Hyderabad", match: ["niloufer", "nilofer"] },
  "ritz classic|Goa": { q: "Ritz Classic, Panjim, Goa", match: ["ritz"] },
  "bhojohori manna|Kolkata": { q: "Bhojohori Manna, Hindustan Road, Kolkata", match: ["bhojohori"] },
  "ratna cafe|Chennai": { q: "Ratna Cafe, Triplicane, Chennai", match: ["ratna"] },
  "vivekananda park phuchkawala|Kolkata": { coords: [22.5137, 88.3593] },
  "k c das|Kolkata": { coords: [22.56547, 88.3515114] },
  "vardaan market phuchka|Kolkata": { q: "Vardaan Market, Camac Street, Kolkata", match: ["vardan"] },
  "pandit gaya prasad shiv charan|Delhi": { q: "Gaya Prasad Paranthe Wale, Chandni Chowk, Delhi", match: ["gaya", "prashad", "prasad"] },
  "pandit kanhaiya lal durga prasad dixit|Delhi": { q: "Paranthe Wali Gali, Delhi", match: ["kanhaiya"] },
  "natraj dahi bhalla corner|Delhi": { q: "Natraj, Chandni Chowk, Delhi", match: ["natraj"] },
  "shree balaji chaat bhandar|Delhi": { q: "Shree Balaji Chaat Bhandar, Chandni Chowk, Delhi", match: ["balaji"] },
  "rawat mishthan bhandar|Jaipur": { q: "Rawat Mishthan Bhandar, Station Road, Jaipur", match: ["rawat"] },
  "laxmi misthan bhandar lmb|Jaipur": { q: "Laxmi Misthan Bhandar, Johari Bazaar, Jaipur", match: ["mishthan", "lmb"] },
  "doodh misthan bhandar|Jaipur": { q: "Doodh Misthan Bhandar, Jaipur", match: ["doodh"] },
  "niros|Jaipur": { q: "Niros, MI Road, Jaipur", match: ["niros"] },
  "mum's kitchen|Goa": { q: "Mum's Kitchen, Panjim, Goa", match: ["mum"] },
  "seagull restaurant|Kochi": { q: "Seagull Restaurant, Fort Kochi, Kochi", match: ["seagull"] },
  "6 ballygunge place|Kolkata": { q: "6 Ballygunge Place, Kolkata", match: ["ballygunge"] },
  "nimrah cafe bakery|Hyderabad": { q: "Nimrah, Hyderabad", match: ["nimrah"] },
  "sassanian boulangerie|Mumbai": { q: "Sassanian Boulangerie, Mumbai", match: ["sassanian"] },
  "haji ali juice centre|Mumbai": { coords: [18.9784, 72.8112] },
  "cream centre|Mumbai": { coords: [18.9556, 72.8133] },
  "mafco farm fair|Mumbai": { q: "Mafco Farm Fair, Worli, Mumbai", match: ["mafco"] },
  "giani's di hatti|Delhi": { q: "Giani di Hatti, Chandni Chowk, Delhi", match: ["giani"] },
};

/** Returns verified coords for "name" in "city", or null. */
async function verify(name: string, city: string): Promise<{ lat: number; lng: number } | null> {
  const ov = OVERRIDES[`${norm(name)}|${city}`];
  if (ov?.coords) return { lat: ov.coords[0], lng: ov.coords[1] };
  const query = ov?.q ? `${ov.q}, India` : `${name}, ${city}, India`;
  const key = `geo:dishindia:${norm(query)}`;
  const cached = await cacheGet<{ hit: { lat: number; lng: number } | null }>(key);
  if (cached) return cached.hit;
  const wait = 1000 - (Date.now() - lastPhotonAt);
  if (wait > 0) await sleep(wait);
  lastPhotonAt = Date.now();
  const center = CITY_CENTERS[city];
  let hit: { lat: number; lng: number } | null = null;
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
    const n = norm(name.replace(/\([^)]*\)/g, " "));
    const extra = (ov?.match ?? []).map((m) => norm(m)).filter((m) => m.length >= 2);
    for (const f of data.features ?? []) {
      const p = f.properties;
      if ((p.countrycode ?? "").toUpperCase() !== "IN") continue;
      const hn = norm(p.name ?? "");
      if (hn.length < 3 || n.length < 3) continue;
      const containment = hn === n || hn.startsWith(n) || hn.includes(n) || n.includes(hn);
      // Token fallback: every distinctive hit token appears in the name
      // (handles "Paradise Biryani" → OSM "Paradise Food Court").
      const JUNK = new Set(["cafe", "coffee", "the", "and", "house", "hotel", "restaurant", "food", "court", "sweets", "sweet", "corner", "co"]);
      const hitTokens = hn.split(" ").filter((t) => t.length >= 3 && !JUNK.has(t));
      const nameTokens = new Set(n.split(" "));
      const tokenOk = hitTokens.length > 0 && hitTokens.every((t) => nameTokens.has(t));
      const overrideHit = extra.some((m) => hn.includes(m));
      if (!containment && !tokenOk && !overrideHit) continue;
      const [lng, lat] = f.geometry.coordinates;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (center && kmBetween(center.lat, center.lng, lat, lng) > center.km) continue;
      hit = { lat, lng };
      break;
    }
  } catch (e) {
    console.warn(`[dishes] photon error for "${query}": ${e instanceof Error ? e.message : e}`);
    await sleep(2000);
    return null; // uncached - retried next run
  }
  await cacheSet(key, { hit }, GEO_TTL_MS);
  return hit;
}

async function main() {
  const dishes = JSON.parse(readFileSync(JSON_PATH, "utf8")) as Dish[];
  // Verify each unique (name, city) once.
  const unique = new Map<string, { name: string; city: string }>();
  for (const d of dishes) for (const p of d.places) unique.set(`${norm(p.name)}|${d.city}`, { name: p.name, city: d.city });
  console.log(`[dishes] ${dishes.length} dishes, ${unique.size} unique places to verify`);

  const verified = new Map<string, { lat: number; lng: number } | null>();
  for (const [k, v] of unique) {
    verified.set(k, await verify(v.name, v.city));
  }

  let kept = 0;
  let dropped = 0;
  let moved = 0;
  const out: Dish[] = [];
  for (const d of dishes) {
    const places: DishPlace[] = [];
    for (const p of d.places) {
      const v = verified.get(`${norm(p.name)}|${d.city}`);
      if (!v) {
        console.log(`[dishes] DROP (unverified): ${p.name} (${d.city} / ${d.dish})`);
        dropped++;
        continue;
      }
      if (kmBetween(p.lat, p.lng, v.lat, v.lng) > 0.05) {
        console.log(`[dishes] coords ${p.name}: ${p.lat},${p.lng} → ${v.lat},${v.lng}`);
        moved++;
      }
      places.push({ ...p, lat: v.lat, lng: v.lng });
      kept++;
    }
    if (places.length > 0) out.push({ ...d, places });
    else console.log(`[dishes] DROP DISH (no verified places): ${d.dish} (${d.city})`);
  }

  console.log(`[dishes] verified: ${kept} kept (${moved} re-coordinated), ${dropped} dropped, ${out.length} dishes remain`);
  if (!DRY_RUN) {
    writeFileSync(JSON_PATH, JSON.stringify(out, null, 2) + "\n");
    console.log(`[dishes] wrote ${JSON_PATH}`);
  } else {
    console.log("[dishes] --dry-run: file not written");
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[dishes] FAILED:", e);
    process.exit(1);
  });
}
