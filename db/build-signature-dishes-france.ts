/**
 * build-signature-dishes-france.ts (r16-france) - generator for
 * db/data/signature-dishes-france.json.
 *
 * Each signature dish is curated from knowledge (blurb + a handful of famous
 * places + a one-line "why"). Every candidate place is then VERIFIED through
 * Photon (keyless, OSM): we geocode "<name>, <city>, France" and keep the
 * place only when the top hit is in France, inside the metro bbox, and its
 * name fuzzy-matches - the verified coordinates are what get written. Places
 * Photon can't confirm are dropped; a dish keeps its 2–4 best-verified spots.
 *
 * Re-run to re-verify / refresh coordinates:
 *     npx tsx db/build-signature-dishes-france.ts
 * Photon data © OpenStreetMap contributors, ODbL.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fetchJson } from "../api/lib/http";
import { normalizeNameKey } from "../api/lib/place-quality";
import type { PhotonResponse } from "../api/queries/overpass";

const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; France signature dishes)";
const BBOX = { s: 41, n: 51.5, w: -5.5, e: 10 };
const GAP_MS = 300;
const OUT = new URL("./data/signature-dishes-france.json", import.meta.url).pathname;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CandidatePlace {
  name: string;
  /** Optional alternate city to geocode against (e.g. Sète for tielle). */
  geoCity?: string;
  why: string;
}
interface Dish {
  city: string;
  dish: string;
  blurb: string;
  places: CandidatePlace[];
}

// ─── curated dishes (24) ─────────────────────────────────────────────────────
const DISHES: Dish[] = [
  // ── Paris ──
  { city: "Paris", dish: "Croissant", blurb: "Buttery, shattering Viennoiserie, the Parisian breakfast icon.", places: [
    { name: "Du Pain et des Idées", why: "Benchmark croissant in a 19th-century boulangerie." },
    { name: "Blé Sucré", why: "Lamination legend near Bastille." },
    { name: "Pierre Hermé", why: "Haute-pâtisserie croissant." },
    { name: "Carette", why: "Classic salon de thé off the Place des Vosges." } ] },
  { city: "Paris", dish: "Steak-frites", blurb: "Entrecôte, crisp frites and a secret sauce. Paris bistro canon.", places: [
    { name: "Le Relais de l'Entrecôte", why: "Single-menu steak-frites institution." },
    { name: "Bistrot Paul Bert", why: "Benchmark bistro steak-frites." },
    { name: "Le Severo", why: "Butcher-owned, dry-aged beef." } ] },
  { city: "Paris", dish: "Macarons", blurb: "Ganache-filled almond-meringue shells in every colour.", places: [
    { name: "Ladurée", why: "Inventor of the double-decker macaron." },
    { name: "Pierre Hermé", why: "The 'Picasso of pastry'." },
    { name: "Sadaharu Aoki", why: "Japanese-French precision macarons." } ] },
  { city: "Paris", dish: "Soupe à l'oignon", blurb: "Caramelized-onion broth under a gratinéed cheese crust.", places: [
    { name: "Au Pied de Cochon", why: "24/7 Les Halles classic since 1947." },
    { name: "La Jacobine", why: "Beloved Saint-Germain onion soup." } ] },
  { city: "Paris", dish: "Jambon-beurre", blurb: "The Parisian ham-and-butter baguette sandwich.", places: [
    { name: "Caractère de Cochon", why: "Marais shop devoted to the jambon-beurre." },
    { name: "Chez Aline", why: "Natural-wine spot's cult sandwich." } ] },
  // ── Lyon ──
  { city: "Lyon", dish: "Quenelles", blurb: "Pike dumplings in creamy Nantua sauce. Lyonnaise comfort.", places: [
    { name: "Café Comptoir Abel", why: "Among the oldest bouchons; textbook quenelles." },
    { name: "Brasserie Georges", why: "Vast 1836 brasserie classic." } ] },
  { city: "Lyon", dish: "Salade lyonnaise", blurb: "Frisée, lardons, croutons and a poached egg.", places: [
    { name: "Daniel et Denise", why: "MOF chef's bouchon staple." },
    { name: "Le Bouchon des Filles", why: "Modern all-in bouchon menu." } ] },
  { city: "Lyon", dish: "Coussin de Lyon", blurb: "Marzipan-and-chocolate ganache cushion, a Lyonnaise sweet.", places: [
    { name: "Voisin", why: "Invented the coussin in 1960." },
    { name: "Chocolaterie Sève", why: "Celebrated Lyon chocolatier-pâtissier." },
    { name: "Pralus", why: "Lyon praline and coussin maker." } ] },
  // ── Marseille ──
  { city: "Marseille", dish: "Bouillabaisse", blurb: "Saffron fish stew with rouille. Marseille's soul.", places: [
    { name: "Chez Fonfon", why: "Vallon des Auffes harbour classic." },
    { name: "Le Rhul", why: "Old-school bouillabaisse authority." },
    { name: "Miramar", why: "Old Port institution." } ] },
  { city: "Marseille", dish: "Navettes", blurb: "Orange-blossom boat-shaped biscuits of Candlemas.", places: [
    { name: "Le Four des Navettes", why: "Marseille's oldest bakery, since 1781." },
    { name: "Les Navettes des Accoules", why: "Le Panier biscuitier keeping the recipe alive." } ] },
  // ── Nice ──
  { city: "Nice", dish: "Socca", blurb: "Blistered chickpea-flour pancake, eaten hot by hand.", places: [
    { name: "Chez Pipo", why: "The socca reference since 1923." },
    { name: "Chez Thérésa", why: "Cours Saleya market socca legend." },
    { name: "Lou Pilha Leva", why: "Counter-service Niçoise staples." } ] },
  { city: "Nice", dish: "Salade niçoise", blurb: "Tomatoes, tuna, anchovy, olives, no cooked vegetables, purists insist.", places: [
    { name: "Le Safari", why: "Cours Saleya classic." },
    { name: "Acchiardo", why: "Family-run Niçoise kitchen." } ] },
  { city: "Nice", dish: "Pissaladière", blurb: "Caramelized-onion tart with anchovies and olives.", places: [
    { name: "La Merenda", why: "Tiny no-phone Niçoise legend." },
    { name: "Lou Pilha Leva", why: "Old-town counter for Niçoise snacks." },
    { name: "Chez Pipo", why: "Also known for pissaladière and tourte de blettes." } ] },
  // ── Bordeaux ──
  { city: "Bordeaux", dish: "Canelé", blurb: "Caramelized-crust, custardy rum-and-vanilla fluted cake.", places: [
    { name: "Baillardran", why: "The canelé house of Bordeaux." },
    { name: "La Toque Cuivrée", why: "Artisan canelé specialist." } ] },
  { city: "Bordeaux", dish: "Entrecôte à la bordelaise", blurb: "Rib steak in a red-wine-and-shallot sauce.", places: [
    { name: "Brasserie Bordelaise", why: "Regional-produce brasserie." },
    { name: "Le Bouchon Bordelais", why: "Classic bordelaise cooking." } ] },
  // ── Strasbourg ──
  { city: "Strasbourg", dish: "Tarte flambée", blurb: "Thin-crust Alsatian flammekueche with crème fraîche, onion and lardons.", places: [
    { name: "Flam's", why: "Dedicated tarte flambée house." },
    { name: "Le Clou", why: "Cosy winstub for flammekueche." },
    { name: "Au Brasseur", why: "Old-town brewpub tarte flambée." } ] },
  { city: "Strasbourg", dish: "Choucroute", blurb: "Sauerkraut piled with sausages and charcuterie.", places: [
    { name: "Maison Kammerzell", why: "1427 landmark by the cathedral." },
    { name: "Au Pont Corbeau", why: "Traditional winstub choucroute." } ] },
  // ── Toulouse ──
  { city: "Toulouse", dish: "Cassoulet", blurb: "Slow-baked white beans with duck confit and Toulouse sausage.", places: [
    { name: "Le Colombier", why: "Cassoulet reference since 1873." },
    { name: "Le Genty Magre", why: "Modern bistro famed for its cassoulet." },
    { name: "Le Bibent", why: "Grand brasserie on the Capitole." } ] },
  // ── Nantes ──
  { city: "Nantes", dish: "Gâteau nantais", blurb: "Moist rum-and-almond cake with a rum glaze.", places: [
    { name: "La Cigale", why: "Opulent 1895 brasserie on Place Graslin." },
    { name: "Maison Larnicol", why: "Breton-Loire artisan biscuitier." } ] },
  // ── Lille ──
  { city: "Lille", dish: "Carbonnade flamande", blurb: "Beer-braised beef stew, sweet-sour with gingerbread.", places: [
    { name: "Au Vieux de la Vieille", why: "Old-town estaminet classic." },
    { name: "Le Barbier qui fume", why: "Smokehouse bistro's Flemish stew." },
    { name: "Estaminet La Chandelle", why: "Traditional Vieux-Lille estaminet." } ] },
  { city: "Lille", dish: "Merveilleux", blurb: "Meringue-and-cream cakes rolled in chocolate shavings, a Lille sweet.", places: [
    { name: "Aux Merveilleux de Fred", why: "Lille-born merveilleux specialist." },
    { name: "Meert", why: "Historic Vieux-Lille pâtissier (gaufres, too)." } ] },
  // ── Montpellier ──
  { city: "Montpellier", dish: "Fougasse", blurb: "Provençal flatbread, savoury with olives or sweet with orange blossom.", places: [
    { name: "Halles Castellane", why: "Covered-market bakers selling fougasse." },
    { name: "Halles Laissac", why: "Montpellier's newer food hall with artisan bakers." },
    { name: "Le Fournil des Arceaux", why: "Arceaux neighbourhood boulangerie." } ] },
  { city: "Montpellier", dish: "Tielle sétoise", blurb: "Spicy octopus-and-tomato pie from nearby Sète.", places: [
    { name: "Chez François", geoCity: "Sète", why: "Canal-side tielle since 1946." },
    { name: "Paradiso", geoCity: "Sète", why: "Sète's tielle institution." },
    { name: "Cianni", geoCity: "Sète", why: "Family tielle maker on the quay." } ] },
];

// ─── Photon verification ─────────────────────────────────────────────────────
const inBbox = (lat: number, lng: number) =>
  lat >= BBOX.s && lat <= BBOX.n && lng >= BBOX.w && lng <= BBOX.e;

/** City centres for the wrong-city guard (a famous same-named place elsewhere
 * in France - e.g. Antibes' Boulangerie Veziano - must not pin a Montpellier
 * dish 250 km away). Keyed by the geocoding city (geoCity). */
const CITY_CENTERS: Record<string, [number, number]> = {
  Paris: [48.8566, 2.3522],
  Lyon: [45.7640, 4.8357],
  Marseille: [43.2965, 5.3698],
  Nice: [43.7102, 7.2620],
  Bordeaux: [44.8378, -0.5792],
  Strasbourg: [48.5734, 7.7521],
  Toulouse: [43.6047, 1.4442],
  Nantes: [47.2184, -1.5536],
  Lille: [50.6292, 3.0573],
  Montpellier: [43.6108, 3.8767],
  "Sète": [43.4028, 3.6967],
};
const CITY_MAX_KM = 50;

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function nameMatches(want: string, got: string): boolean {
  const a = normalizeNameKey(want);
  const b = normalizeNameKey(got);
  if (a.length < 3 || b.length < 3) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function geocode(name: string, city: string): Promise<{ lat: number; lng: number; name: string } | null> {
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
    // Wrong-city guard: must land near the intended city's centre.
    if (center && kmBetween(center[0], center[1], lat, lng) > CITY_MAX_KM) continue;
    return { lat, lng, name: pname };
  }
  return null;
}

async function main() {
  const out: unknown[] = [];
  let kept = 0, dropped = 0;
  for (const d of DISHES) {
    const places: unknown[] = [];
    for (const cand of d.places) {
      const geoCity = cand.geoCity ?? d.city;
      try {
        const hit = await geocode(cand.name, geoCity);
        if (hit) {
          places.push({
            name: cand.name,
            lat: Math.round(hit.lat * 1e4) / 1e4,
            lng: Math.round(hit.lng * 1e4) / 1e4,
            why: cand.why,
          });
          kept++;
          console.log(`  OK ${d.city} / ${d.dish}: ${cand.name} → ${hit.lat.toFixed(4)},${hit.lng.toFixed(4)}`);
        } else {
          dropped++;
          console.log(`  DROP ${d.city} / ${d.dish}: ${cand.name} (unverified)`);
        }
      } catch (e) {
        dropped++;
        console.log(`  ERR ${d.city} / ${d.dish}: ${cand.name}, ${e instanceof Error ? e.message : e}`);
      }
      await sleep(GAP_MS);
      if (places.length >= 4) break; // cap 4 per dish
    }
    if (places.length === 0) {
      console.log(`  !! ${d.city} / ${d.dish}: NO verified places, dish skipped`);
      continue;
    }
    out.push({ city: d.city, country: "France", dish: d.dish, blurb: d.blurb, places });
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n[dishes] wrote ${out.length} dishes → ${OUT} (places kept ${kept}, dropped ${dropped})`);
  const thin = (out as { dish: string; places: unknown[] }[]).filter((d) => d.places.length < 2);
  if (thin.length) console.log("[dishes] dishes with <2 places:", thin.map((d) => d.dish).join(", "));
  process.exit(0);
}

main().catch((e) => { console.error("[dishes] FAILED:", e); process.exit(1); });
