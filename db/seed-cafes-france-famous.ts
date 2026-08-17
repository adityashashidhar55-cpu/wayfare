/**
 * seed-cafes-france-famous.ts (r16-france) - curated FAMOUS cafés for the
 * French majors, from knowledge. Distinct from the bulk OSM café import: these
 * are the destination cafés / specialty-coffee landmarks a traveller asks for,
 * stamped famousEatery=1, source='curated', rating 4.4-4.7.
 *
 * Every candidate is VERIFIED through Photon ("<name>, <city>, France"): kept
 * only when the hit is in France, inside the metro bbox, name fuzzy-matches,
 * AND lands within 50 km of the intended city centre (a same-named café in
 * another town must not be pinned here). Unverifiable candidates are skipped.
 *
 * Idempotent: a candidate is skipped when the corpus already holds a place
 * with the same normalized name within 1 km of the verified point (so re-runs
 * insert nothing, and we never duplicate an OSM-imported Café de Flore).
 * Photos are best-effort via DBpedia (Wikipedia is unreachable from this
 * sandbox); historic cafés (Flore, Les Deux Magots, Le Procope…) often have
 * articles, specialty bars usually don't - photo failures never abort the run.
 * Progress checkpoints to api_cache ('seed:cafes-france:checkpoint').
 *
 * Run:    npx tsx db/seed-cafes-france-famous.ts [--no-photos] [--reset]
 * Photon data © OpenStreetMap contributors, ODbL.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet } from "../api/lib/cache";
import { fetchJson } from "../api/lib/http";
import { kmBetween } from "../api/queries/coverage";
import { normalizeNameKey } from "../api/lib/place-quality";
import type { PhotonResponse } from "../api/queries/overpass";
import { dbpediaPhotosForBatch } from "./seed-photos";

const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; France famous cafés)";
const CHECKPOINT_KEY = "seed:cafes-france:checkpoint";
const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const BBOX = { s: 41, n: 51.5, w: -5.5, e: 10 };
const GEOCODE_GAP_MS = 300;
const DEDUPE_KM = 1;
const NO_PHOTOS = process.argv.includes("--no-photos");
const RESET = process.argv.includes("--reset");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** City centres for the wrong-city guard. */
const CITY_CENTERS: Record<string, [number, number]> = {
  Paris: [48.8566, 2.3522],
  Lyon: [45.764, 4.8357],
  Marseille: [43.2965, 5.3698],
  Nice: [43.7102, 7.262],
  Bordeaux: [44.8378, -0.5792],
  Strasbourg: [48.5734, 7.7521],
  Toulouse: [43.6047, 1.4442],
  Nantes: [47.2184, -1.5536],
  Lille: [50.6292, 3.0573],
  Montpellier: [43.6108, 3.8767],
};
// Tight radius: a "famous café of <city>" sits in the urban core. 50 km let a
// same-named café in a neighbouring town through once (a "Mélodie Café" 29 km
// south of Nantes, in Vendée) - that row was deleted and the guard tightened.
const CITY_MAX_KM = 25;

interface CafeCand {
  name: string;
  rating: number; // 4.4-4.7
  blurb: string;
  tags?: string[]; // extra tags beyond cafe/coffee
}
const CAFES: Record<string, CafeCand[]> = {
  Paris: [
    { name: "Café de Flore", rating: 4.6, blurb: "Saint-Germain institution of Sartre and Beauvoir.", tags: ["historic"] },
    { name: "Les Deux Magots", rating: 4.5, blurb: "Literary café facing Saint-Germain church.", tags: ["historic"] },
    { name: "Angelina", rating: 4.5, blurb: "Belle-Époque salon famous for chocolat chaud.", tags: ["bakery"] },
    { name: "Café de la Paix", rating: 4.5, blurb: "Opulent 1862 café by the Opéra Garnier.", tags: ["historic"] },
    { name: "Le Procope", rating: 4.5, blurb: "Paris' oldest café (1686), haunt of Voltaire.", tags: ["historic"] },
    { name: "Holybelly", rating: 4.6, blurb: "Canal-side specialty coffee and brunch.", tags: ["brunch"] },
    { name: "Ten Belles", rating: 4.5, blurb: "Tiny Canal Saint-Martin specialty pioneer." },
    { name: "Fragments", rating: 4.4, blurb: "Marais espresso bar and roastery." },
    { name: "Boot Café", rating: 4.5, blurb: "Microscopic Marais coffee counter." },
    { name: "Café Kitsuné", rating: 4.4, blurb: "Fashion-house café in the Palais-Royal garden." },
    { name: "Télescope", rating: 4.5, blurb: "Quiet specialty pioneer near the Louvre." },
    { name: "La Caféothèque", rating: 4.5, blurb: "Seine-side roaster that started it all." },
  ],
  Lyon: [
    { name: "Café Mokxa", rating: 4.5, blurb: "Specialty roaster's Lyon café." },
    { name: "Puzzle Café", rating: 4.5, blurb: "Croix-Rousse specialty coffee and cake." },
    { name: "Slake Coffee House", rating: 4.5, blurb: "Minimal specialty bar near the Presqu'île." },
    { name: "La Boîte à Café", rating: 4.5, blurb: "Mokxa's flagship coffee bar by the Rhône." },
    { name: "Awayk", rating: 4.4, blurb: "Neighbourhood specialty café, Guillotière." },
    { name: "Gone Café", rating: 4.4, blurb: "Third-wave coffee and brunch spot.", tags: ["brunch"] },
    { name: "Café de la Cathédrale", rating: 4.4, blurb: "Terrace facing Saint-Jean cathedral.", tags: ["historic"] },
    { name: "Café Livres", rating: 4.4, blurb: "Book café near the opera." },
    { name: "Café Tétras", rating: 4.4, blurb: "Croix-Rousse local favourite." },
  ],
  Marseille: [
    { name: "Café de l'Abbaye", rating: 4.4, blurb: "Saint-Victor institution with sea views.", tags: ["historic"] },
    { name: "Torréfaction Noailles", rating: 4.5, blurb: "Old-roastery café off La Canebière.", tags: ["historic"] },
    { name: "7VB", rating: 4.5, blurb: "Specialty coffee and brunch, Rue Vacon.", tags: ["brunch"] },
    { name: "Deep Coffee Roasters", rating: 4.5, blurb: "Marseille's specialty roastery-café." },
    { name: "Café Bovo", rating: 4.4, blurb: "Design-forward coffee near the Old Port." },
    { name: "Café l'Écomotive", rating: 4.4, blurb: "Eco café-cantine by Saint-Charles." },
    { name: "Möka", rating: 4.4, blurb: "Specialty coffee near Cours Julien." },
    { name: "R2 Café", rating: 4.4, blurb: "Coffee on the Réformés-Canebière rooftop." },
  ],
  Nice: [
    { name: "Café Marché", rating: 4.5, blurb: "Specialty coffee by the Cours Saleya market." },
    { name: "Paper Plane", rating: 4.5, blurb: "Third-wave coffee and brunch, Rue Gubernatis.", tags: ["brunch"] },
    { name: "Café Fino", rating: 4.5, blurb: "Port-area specialty coffee bar." },
    { name: "Café Indien", rating: 4.4, blurb: "Roaster-café in the old town." },
    { name: "Comme un Dimanche", rating: 4.5, blurb: "Cosy brunch and specialty coffee.", tags: ["brunch"] },
    { name: "Edmond Café", rating: 4.4, blurb: "Neighbourhood specialty spot, Le Port." },
    { name: "La Claque Café", rating: 4.4, blurb: "Old-town coffee and vinyl." },
  ],
  Bordeaux: [
    { name: "Café Piha", rating: 4.5, blurb: "Bordeaux's specialty coffee reference." },
    { name: "L'Alchimiste", rating: 4.5, blurb: "Roaster-café near the cathedral." },
    { name: "Horizon Café", rating: 4.5, blurb: "Minimal specialty bar, Chartrons." },
    { name: "Café Kokomo", rating: 4.5, blurb: "Specialty coffee and brunch.", tags: ["brunch"] },
    { name: "Black List Café", rating: 4.5, blurb: "Third-wave coffee, Rue des Remparts." },
    { name: "Books & Coffee", rating: 4.4, blurb: "Bookshop café by the Grosse Cloche." },
    { name: "SIP Coffee", rating: 4.4, blurb: "Neighbourhood specialty, Saint-Michel." },
    { name: "Oven Heaven", rating: 4.4, blurb: "Coffee and sourdough bakery.", tags: ["bakery"] },
  ],
  Strasbourg: [
    { name: "Café Bretelles", rating: 4.5, blurb: "Strasbourg's specialty coffee pioneer." },
    { name: "Oh My Goodness", rating: 4.5, blurb: "Coffee and brunch near the cathedral.", tags: ["brunch"] },
    { name: "Café Mokxa", rating: 4.5, blurb: "The Strasbourg specialty roaster." },
    { name: "Stub Café", rating: 4.4, blurb: "Krutenau neighbourhood coffee." },
    { name: "Café Dori", rating: 4.4, blurb: "Specialty coffee and cakes." },
    { name: "Ôjourd'hui", rating: 4.4, blurb: "Cosy coffee and brunch spot.", tags: ["brunch"] },
    { name: "Café Coklats", rating: 4.4, blurb: "Petite-France coffee and chocolate." },
  ],
  Toulouse: [
    { name: "Café Cerise", rating: 4.5, blurb: "Specialty coffee and brunch, Carmes.", tags: ["brunch"] },
    { name: "La Fiancée", rating: 4.5, blurb: "Roaster-café near Saint-Sernin." },
    { name: "Hayuco", rating: 4.5, blurb: "Third-wave coffee, Rue des Filatiers." },
    { name: "Allegory Coffee", rating: 4.4, blurb: "Specialty coffee bar, Les Chalets." },
    { name: "Café Brûlé", rating: 4.4, blurb: "Neighbourhood roaster-café." },
    { name: "Minimes Café", rating: 4.4, blurb: "Canal-side specialty coffee." },
  ],
  Nantes: [
    { name: "Café Calico", rating: 4.5, blurb: "Specialty coffee and brunch.", tags: ["brunch"] },
    { name: "Mélodie Café", rating: 4.4, blurb: "Neighbourhood specialty coffee." },
    { name: "Rumcraft Coffee", rating: 4.4, blurb: "Third-wave coffee near Graslin." },
  ],
  Lille: [
    { name: "Café Méo", rating: 4.4, blurb: "Grand Place café since 1928.", tags: ["historic"] },
    { name: "Oxford Café", rating: 4.4, blurb: "Specialty coffee and brunch.", tags: ["brunch"] },
    { name: "Café Citoyen", rating: 4.4, blurb: "Neighbourhood coffee, Wazemmes." },
  ],
  Montpellier: [
    { name: "Café Bun", rating: 4.4, blurb: "Specialty coffee and buns, Écusson." },
    { name: "Coldrip Food & Coffee", rating: 4.4, blurb: "Third-wave coffee near Saint-Roch." },
    { name: "Café Gramme", rating: 4.4, blurb: "Specialty coffee, Rue de l'Université." },
  ],
};

// ─── Photon verify (with wrong-city guard) ──────────────────────────────────
const inBbox = (lat: number, lng: number) => lat >= BBOX.s && lat <= BBOX.n && lng >= BBOX.w && lng <= BBOX.e;
function nameMatches(want: string, got: string): boolean {
  const a = normalizeNameKey(want);
  const b = normalizeNameKey(got);
  if (a.length < 3 || b.length < 3) return false;
  return a === b || a.includes(b) || b.includes(a);
}
interface Verified { lat: number; lng: number; photonName: string }
async function geocode(name: string, city: string): Promise<Verified | null> {
  const url = new URL(PHOTON_API);
  url.searchParams.set("q", `${name}, ${city}, France`);
  url.searchParams.set("limit", "5");
  url.searchParams.set("lang", "en");
  const data = await fetchJson<PhotonResponse>(url, { service: "photon", userAgent: USER_AGENT, timeoutMs: 10_000 });
  const center = CITY_CENTERS[city];
  for (const f of data.features ?? []) {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if ((p.country ?? "") !== "France" || !inBbox(lat, lng)) continue;
    const pname = (p.name ?? "").trim();
    if (!pname || !nameMatches(name, pname)) continue;
    if (center && kmBetween(center[0], center[1], lat, lng) > CITY_MAX_KM) continue;
    return { lat, lng, photonName: pname };
  }
  return null;
}

/** Ids of corpus rows with the same normalized name already within DEDUPE_KM
 * (idempotency + no OSM dupes; also the rows we then stamp famousEatery=1). */
async function nearbyIds(db: ReturnType<typeof getDb>, name: string, lat: number, lng: number): Promise<number[]> {
  const d = 0.02; // ~2 km bbox prefilter
  const res = await db.execute(sql`
    SELECT id, name, lat, lng FROM explore_places
    WHERE lat BETWEEN ${lat - d} AND ${lat + d} AND lng BETWEEN ${lng - d} AND ${lng + d}
    LIMIT 400`);
  const rows = (Array.isArray(res) ? res[0] : res) as unknown as { id: number; name: string; lat: number; lng: number }[];
  const key = normalizeNameKey(name);
  return rows
    .filter(
      (r) => r.lat != null && r.lng != null && kmBetween(lat, lng, r.lat, r.lng) <= DEDUPE_KM &&
        (normalizeNameKey(r.name) === key || normalizeNameKey(r.name).includes(key) || key.includes(normalizeNameKey(r.name))),
    )
    .map((r) => Number(r.id));
}

interface CityStat { verified: number; inserted: number; skippedExisting: number; stamped: number; unverifiable: number }
interface Checkpoint { doneCities: string[]; stats: Record<string, CityStat>; updatedAt: string }

async function main() {
  const db = getDb();
  let cp = (!RESET && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || null;
  if (!cp) cp = { doneCities: [], stats: {}, updatedAt: "" };
  else console.log(`[cafes-fr] resuming after ${cp.doneCities.length} cities`);

  const insertedForPhotos: { id: number; name: string; city: string }[] = [];

  for (const [city, cands] of Object.entries(CAFES)) {
    if (cp.doneCities.includes(city)) continue;
    const stat: CityStat = { verified: 0, inserted: 0, skippedExisting: 0, stamped: 0, unverifiable: 0 };
    for (const cand of cands) {
      let v: Verified | null = null;
      try { v = await geocode(cand.name, city); }
      catch (e) { console.warn(`  ERR geocode ${cand.name}: ${e instanceof Error ? e.message : e}`); }
      await sleep(GEOCODE_GAP_MS);
      if (!v) { stat.unverifiable++; console.log(`  SKIP ${city}: ${cand.name} (unverified)`); continue; }
      stat.verified++;
      try {
        const dupIds = await nearbyIds(db, cand.name, v.lat, v.lng);
        if (dupIds.length > 0) {
          // Already in the corpus (often the OSM corpus import, which leaves
          // famousEatery=0). Don't duplicate - but DO stamp the famous badge so
          // these verified famous cafés surface as "★ Famous pick".
          stat.skippedExisting++;
          await db.update(schema.explorePlaces)
            .set({ famousEatery: true })
            .where(inArray(schema.explorePlaces.id, dupIds));
          stat.stamped += dupIds.length;
          console.log(`  DUP  ${city}: ${cand.name} (within ${DEDUPE_KM} km, stamped famousEatery on ${dupIds.length})`);
          continue;
        }
        const tags = Array.from(new Set(["cafe", "coffee", ...(cand.tags ?? [])])).slice(0, 4);
        const ins = await db.insert(schema.explorePlaces).values({
          name: cand.name.slice(0, 255),
          city,
          country: "France",
          lat: v.lat,
          lng: v.lng,
          category: "food",
          tags,
          styles: [],
          rating: cand.rating,
          priceLevel: 2,
          description: cand.blurb,
          famousEatery: true,
          source: "curated",
          approved: true,
        });
        stat.inserted++;
        // capture the new id for the photo pass (insertId on mysql2)
        const hdr = Array.isArray(ins) ? ins[0] : ins;
        const newId = Number((hdr as { insertId?: number })?.insertId ?? 0);
        if (newId) insertedForPhotos.push({ id: newId, name: cand.name, city });
        console.log(`  OK   ${city}: ${cand.name} → ${v.lat.toFixed(4)},${v.lng.toFixed(4)}`);
      } catch (e) {
        console.warn(`  ERR insert ${cand.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    cp.doneCities.push(city);
    cp.stats[city] = stat;
    cp.updatedAt = new Date().toISOString();
    await cacheSet(CHECKPOINT_KEY, cp, TTL_30D);
    console.log(`[cafes-fr] ${city}: +${stat.inserted} inserted, ${stat.skippedExisting} existing (${stat.stamped} stamped ★), ${stat.unverifiable} unverified`);
  }

  // Best-effort Wikipedia/DBpedia photos for the freshly inserted cafés.
  if (!NO_PHOTOS && insertedForPhotos.length > 0) {
    console.log(`[cafes-fr] photo pass for ${insertedForPhotos.length} inserted cafés (DBpedia, best-effort)`);
    for (let i = 0; i < insertedForPhotos.length; i += 10) {
      const batch = insertedForPhotos.slice(i, i + 10);
      try {
        const hits = await dbpediaPhotosForBatch(batch);
        for (const [id, hit] of hits) {
          await db.update(schema.explorePlaces)
            .set({ image: hit.image, photoSource: "wikipedia", photoAttribution: hit.attribution })
            .where(eq(schema.explorePlaces.id, id));
        }
        console.log(`[cafes-fr] photos: ${hits.size}/${batch.length} in this batch`);
      } catch (e) { console.warn(`[cafes-fr] photo batch failed (non-fatal): ${e instanceof Error ? e.message : e}`); }
      await sleep(2500);
    }
  }

  console.log("\n[cafes-fr] ===== per-city report =====");
  for (const [city, s] of Object.entries(cp.stats)) {
    console.log(`  ${city.padEnd(12)} inserted ${s.inserted} | verified ${s.verified} | existing ${s.skippedExisting} (stamped ${s.stamped}) | unverified ${s.unverifiable}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error("[cafes-fr] FAILED:", e); process.exit(1); });
