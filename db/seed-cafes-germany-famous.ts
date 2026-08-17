/**
 * seed-cafes-germany-famous.ts (r16-germany) - curated FAMOUS German cafés.
 *
 * Hand-picked 8-12 famous cafés / coffee houses per city (Berlin specialty
 * pioneers, Munich institutions, Hamburg roasteries, the classic
 * Kaffeehäuser of Cologne/Frankfurt/Dresden/Heidelberg + Leipzig/Nuremberg/
 * Stuttgart). Every candidate is VERIFIED through Photon
 * ("name, city, Germany"): a match must be in Germany, fuzzy-match the
 * name, and sit within 25 km of the geocoded city centre - verified coords
 * are taken from Photon; unverifiable candidates are skipped (logged).
 *
 * Inserted rows: category='food', tags ['cafe','coffee',…], styles [],
 * rating 4.4–4.7, famousEatery=1 (★ Famous pick), source='curated',
 * priceLevel=2, one-line description. Wikipedia/DBpedia photo attached
 * when the r13 photo engine finds one.
 *
 * Idempotent: a candidate is skipped when a same-normalized-name row
 * already exists within 1 km in that city. Checkpoint per city in
 * api_cache ('seed:cafes-de-famous:checkpoint') - sandbox-wipe safe.
 *
 * Run:  npx tsx db/seed-cafes-germany-famous.ts [--restart]
 */
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet } from "../api/lib/cache";
import { fetchJson } from "../api/lib/http";
import { normalizeNameKey } from "../api/lib/place-quality";
import { geocodeCityInCountry } from "../api/queries/overpass";

/** normalizeNameKey plus U+2018/2019 apostrophe folding + token-prefix match
 * ("Konnopke's Imbiss" ↔ Photon "Konnopke’s Imbiß",
 *  "Apfelwein Wagner" ↔ "Apfelweinwirtschaft Wagner"). */
const normKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss")
    .replace(/ø/g, "o").replace(/ł/g, "l").replace(/[đð]/g, "d").replace(/þ/g, "th")
    .replace(/[‘’‛'ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function nameMatches(a: string, b: string): boolean {
  const ta = normKey(a).split(" ").filter(Boolean);
  const tb = normKey(b).split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  const hit = (x: string, ys: string[]) =>
    ys.some((y) => y === x || (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y)));
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => hit(t, long));
}
import { kmBetween } from "../api/lib/getaways-shared";
import {
  dbpediaPhotosForBatch,
  wikiPhotoForPlace,
  wikipediaReachable,
} from "./seed-photos";

const CHECKPOINT_KEY = "seed:cafes-de-famous:checkpoint";
const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; famous German cafés)";
const CITY_MATCH_KM = 25;
const DEDUPE_KM = 1;
const RESTART = process.argv.includes("--restart");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CafeSpec {
  name: string;
  rating: number;
  blurb: string;
  extraTags?: string[];
}

/** name → city → candidates (r16 mission list, lightly extended). */
const CAFES: Record<string, CafeSpec[]> = {
  Berlin: [
    { name: "The Barn", rating: 4.6, blurb: "Berlin's specialty-coffee pioneer; single-origin roasts at the Auguststraße flagship.", extraTags: ["specialty-coffee"] },
    { name: "Bonanza Coffee Roasters", rating: 4.6, blurb: "Minimalist Prenzlauer Berg roastery that helped define Berlin third-wave coffee.", extraTags: ["specialty-coffee"] },
    { name: "Five Elephant", rating: 4.6, blurb: "Kreuzberg roastery famous for its cheesecake as much as its Ethiopian pour-overs.", extraTags: ["specialty-coffee", "cake"] },
    { name: "Café Einstein Stammhaus", rating: 4.5, blurb: "Vienna-style grand café in a pre-war villa; apfelstrudel and melange since 1978.", extraTags: ["viennese", "cake"] },
    { name: "Kaffee 9", rating: 4.5, blurb: "Tiny bar inside Markthalle Neun pouring espresso by the nine-minute extraction rule.", extraTags: ["espresso", "market"] },
    { name: "Distrikt Coffee", rating: 4.5, blurb: "Mitte brunch-and-flat-white institution with industrial-chic room.", extraTags: ["brunch"] },
    { name: "Hallesches Haus", rating: 4.4, blurb: "Café, store and event space in a 1902 post-office hall by the Landwehrkanal.", extraTags: ["brunch"] },
    { name: "Zeit für Brot", rating: 4.6, blurb: "Watch bakers roll the city's favourite cinnamon buns through the glass counter.", extraTags: ["bakery", "breakfast"] },
    { name: "Father Carpenter Coffee Brewers", rating: 4.5, blurb: "Laneway-hideaway in Mitte for meticulous filter coffee and all-day breakfast.", extraTags: ["specialty-coffee", "brunch"] },
    { name: "Café Anna Blume", rating: 4.4, blurb: "Art-nouveau corner café on Kollwitzplatz, beloved for its tiered breakfast trays.", extraTags: ["breakfast", "cake"] },
  ],
  Munich: [
    { name: "Man vs Machine", rating: 4.6, blurb: "Munich's benchmark specialty roaster; stark concrete bar on Müllerstraße.", extraTags: ["specialty-coffee"] },
    { name: "Café Frischhut", rating: 4.6, blurb: "The Schmalznudel institution by Viktualienmarkt, lard-fried dough since 1973.", extraTags: ["bakery", "bavarian"] },
    { name: "Café Luitpold", rating: 4.5, blurb: "Grand 1888 coffee house near Odeonsplatz with a praline counter of its own.", extraTags: ["cake", "historic"] },
    { name: "Aroma Kaffeebar", rating: 4.5, blurb: "Glockenbachviertel living-room café with strong espresso and stronger people-watching.", extraTags: ["espresso"] },
    { name: "Café Blá", rating: 4.4, blurb: "Blue-tiled neighbourhood café near Gärtnerplatz for slow weekend breakfasts.", extraTags: ["breakfast"] },
    { name: "Café Vits", rating: 4.5, blurb: "Old-school Kaffeehaus in the Glockenbachviertel, roasting its own since 1972.", extraTags: ["roastery", "cake"] },
    { name: "Standl 20", rating: 4.5, blurb: "Pocket-sized specialty coffee bar at Elisabethmarkt in the Westend.", extraTags: ["specialty-coffee"] },
    { name: "Sweet Spot Kaffee", rating: 4.4, blurb: "Specialty roaster tucked into the Glockenbachviertel's alleys.", extraTags: ["specialty-coffee"] },
    { name: "Café Jasmin", rating: 4.4, blurb: "1950s throwback café-bar in Maxvorstadt pouring into the night.", extraTags: ["historic"] },
    { name: "Cotidiano Gärtnerplatz", rating: 4.4, blurb: "All-day breakfast favourite on the Gärtnerplatz corner.", extraTags: ["brunch"] },
  ],
  Hamburg: [
    { name: "elbgold Röstkaffee", rating: 4.6, blurb: "Hamburg's flagship third-wave roastery in the Schanzenviertel's old factory yard.", extraTags: ["specialty-coffee", "roastery"] },
    { name: "Nord Coast Coffee Roastery", rating: 4.6, blurb: "Speicherstadt-adjacent roastery pouring Nordic-style light roasts on Deichstraße.", extraTags: ["specialty-coffee"] },
    { name: "Playground Coffee", rating: 4.5, blurb: "St. Pauli specialty bar by Veljko Tatalović, tiny and serious about extraction.", extraTags: ["specialty-coffee"] },
    { name: "Café Paris", rating: 4.5, blurb: "1882 French café behind the Rathaus, tiled walls, croque and Kaffee.", extraTags: ["historic", "breakfast"] },
    { name: "Herr Max", rating: 4.5, blurb: "Schanze institution: wedding-worthy cakes and a room full of vintage lamps.", extraTags: ["cake"] },
    { name: "Black Delight", rating: 4.5, blurb: "Ottensen specialty café roasting single origins for the west of the city.", extraTags: ["specialty-coffee"] },
    { name: "Café Leonar", rating: 4.4, blurb: "Grindelviertel café with Jewish-German roots and legendary cheesecake.", extraTags: ["cake", "historic"] },
    { name: "Marshall Coffee Company", rating: 4.4, blurb: "Aussie-leaning espresso bar near the Elbe, flat whites done right.", extraTags: ["espresso"] },
    { name: "Café Gnosa", rating: 4.4, blurb: "St. Georg's storied LGBTQ café serving breakfast and cake since 1950s days.", extraTags: ["breakfast", "cake"] },
    { name: "Stockholm Espresso Club", rating: 4.4, blurb: "Scandi-minimal espresso and cinnamon buns near Alster.", extraTags: ["espresso", "bakery"] },
  ],
  Cologne: [
    { name: "Café Reichard", rating: 4.5, blurb: "Konditorei since 1855 directly under the Dom, truffles with a cathedral view.", extraTags: ["cake", "historic"] },
    { name: "The Coffee Gang", rating: 4.5, blurb: "Cologne's specialty-coffee gang on Hohenstaufenring, roastery attached.", extraTags: ["specialty-coffee"] },
    { name: "Café Sehnsucht", rating: 4.5, blurb: "Organic Ehrenfeld favourite with a creaky wooden floor and big breakfasts.", extraTags: ["organic", "breakfast"] },
    { name: "Heilandt Kaffeerösterei", rating: 4.5, blurb: "Ehrenfeld micro-roastery and espresso bar, beans roasted on site.", extraTags: ["roastery", "espresso"] },
    { name: "Café Thielemans", rating: 4.4, blurb: "Südstadt classic for cake and Kölsch-area people-watching.", extraTags: ["cake"] },
    { name: "Milchmädchen", rating: 4.4, blurb: "Belgian Quarter corner café with vegan cakes and a devoted laptop crowd.", extraTags: ["vegan", "cake"] },
    { name: "Hommage", rating: 4.4, blurb: "Café-bistro on Chlodwigplatz pouring strong coffee to the Südstadt.", extraTags: ["brunch"] },
    { name: "Café Feynsinn", rating: 4.4, blurb: "Nippes' breakfast institution on Neusser Straße.", extraTags: ["breakfast"] },
  ],
  Frankfurt: [
    { name: "Kaffeehaus Goldene Waage", rating: 4.5, blurb: "Cake and coffee inside the reconstructed 1619 half-timbered jewel on the Römerberg.", extraTags: ["historic", "cake"] },
    { name: "Hoppenworth & Ploch", rating: 4.6, blurb: "Frankfurt's specialty-coffee standard-bearer, roasting in the city since 2012.", extraTags: ["specialty-coffee", "roastery"] },
    { name: "Café Karin", rating: 4.5, blurb: "Cosy Alt-Sachsenhausen-adjacent classic near Goethe's birthplace for long breakfasts.", extraTags: ["breakfast"] },
    { name: "Wacker's Kaffee", rating: 4.5, blurb: "Roasting since 1914, the tiny Kornmarkt shop is Frankfurt coffee history.", extraTags: ["roastery", "historic"] },
    { name: "kaffeewerk Espressionist", rating: 4.5, blurb: "Design-forward espresso bar by the Hauptwache with competition-grade shots.", extraTags: ["espresso"] },
    { name: "Café Laumer", rating: 4.4, blurb: "Westend Konditorei-café with a garden terrace, running since 1919.", extraTags: ["cake", "historic"] },
    { name: "Bitter & Zart", rating: 4.5, blurb: "Braubachstraße chocolaterie-café famous for drinking chocolate and pralines.", extraTags: ["chocolate"] },
    { name: "Maingold", rating: 4.4, blurb: "Concept-store café at the Alte Oper end of town for slow filter coffee.", extraTags: ["filter-coffee"] },
  ],
  Dresden: [
    { name: "Café Schinkelwache", rating: 4.5, blurb: "Coffee and Eierschecke inside Schinkel's 1832 guardhouse on Theaterplatz.", extraTags: ["historic", "cake"] },
    { name: "Coselpalais", rating: 4.5, blurb: "Grand café in the 1765 Cosel palace by the Frauenkirche.", extraTags: ["historic", "cake"] },
    { name: "Café Continental", rating: 4.5, blurb: "Äußere Neustadt institution, breakfast until late, cake counter all day.", extraTags: ["breakfast", "cake"] },
    { name: "Lloyd's Café & Kaffeehaus", rating: 4.4, blurb: "Neustadt coffee house with a loyal morning crowd and serious Kuchen.", extraTags: ["breakfast"] },
    { name: "Café Toscana", rating: 4.4, blurb: "Schillerplatz corner café between Blasewitz villas and the Blue Wonder bridge.", extraTags: ["cake"] },
    { name: "Kuchen Atelier", rating: 4.5, blurb: "Neustadt cake atelier whose counter sells out most afternoons.", extraTags: ["cake"] },
    { name: "Café V-Cake", rating: 4.4, blurb: "All-vegan café off Alaunstraße with celiac-friendly cakes.", extraTags: ["vegan", "cake"] },
    { name: "Elbsalon", rating: 4.4, blurb: "Loschwitz hillside café with river views towards the Elbe castles.", extraTags: ["view"] },
  ],
  Heidelberg: [
    { name: "Café Knösel", rating: 4.6, blurb: "Birthplace of the Studentenkuss chocolate praline, Haspelgasse since 1863.", extraTags: ["historic", "chocolate"] },
    { name: "Café Noltemeyer", rating: 4.5, blurb: "Altstadt café and Konditorei beloved for breakfast and fruit tarts.", extraTags: ["breakfast", "cake"] },
    { name: "nomad", rating: 4.5, blurb: "Heidelberg's specialty-coffee outpost on Untere Straße.", extraTags: ["specialty-coffee"] },
    { name: "Café Rossi", rating: 4.5, blurb: "Iconic all-day café-bar on Rohrbacher Straße, students to professors.", extraTags: ["historic"] },
    { name: "Café Burkardt", rating: 4.4, blurb: "Old-town café on Untere Straße with a sunny terrace and homemade cakes.", extraTags: ["cake"] },
    { name: "Café Schafheutle", rating: 4.4, blurb: "Hauptstraße Konditorei since 1839 with a garden out back.", extraTags: ["historic", "cake"] },
    { name: "Kaffeezimmer", rating: 4.4, blurb: "Weststadt living-room café for filter coffee and vinyl afternoons.", extraTags: ["filter-coffee"] },
    { name: "Gundel Konditorei", rating: 4.4, blurb: "Family bakery-café near Bismarckplatz known for its Baumkuchen.", extraTags: ["bakery", "cake"] },
  ],
  Leipzig: [
    { name: "Zum Arabischen Coffe Baum", rating: 4.5, blurb: "Coffee house since 1711. Goethe, Leibniz and Wagner drank here.", extraTags: ["historic", "cake"] },
    { name: "Kaffeehaus Riquet", rating: 4.5, blurb: "Elephant-gabled art-nouveau Kaffeehaus on the Markt, roasting since 1745.", extraTags: ["historic", "roastery"] },
    { name: "Café Grundmann", rating: 4.5, blurb: "Viennese-style Kaffeehaus with marble tables and Sachertorte homage.", extraTags: ["viennese", "cake"] },
    { name: "Café Corso", rating: 4.4, blurb: "Südvorstadt all-day breakfast anchor on Karl-Liebknecht-Straße.", extraTags: ["breakfast"] },
    { name: "Café Luise", rating: 4.4, blurb: "Gohlis neighbourhood classic with a leafy garden and home-baked cakes.", extraTags: ["cake", "garden"] },
    { name: "Milchbar Pinguin", rating: 4.4, blurb: "1960s GDR milk bar on Katharinenstraße serving retro Eiskaffee.", extraTags: ["historic", "ice-cream"] },
    { name: "Café Waldi", rating: 4.4, blurb: "Tiny specialty bar near the Markt pulling Leipzig's sharpest espressos.", extraTags: ["specialty-coffee"] },
    { name: "Funkencafé", rating: 4.4, blurb: "Connewitz cultural café with courtyard and vegan Sunday brunch.", extraTags: ["vegan", "brunch"] },
  ],
  Nuremberg: [
    { name: "Café Wanderer", rating: 4.5, blurb: "Crooked half-timbered café by the Tiergärtnertor below the castle.", extraTags: ["historic", "cake"] },
    { name: "Machhörndl Kaffee", rating: 4.6, blurb: "Nuremberg's pioneering specialty roaster, espresso bar at the roastery.", extraTags: ["specialty-coffee", "roastery"] },
    { name: "Café Mainheim", rating: 4.4, blurb: "Gostenhof institution mixing Kaffeehaus charm with offbeat events.", extraTags: ["historic"] },
    { name: "Café Bar Katz", rating: 4.4, blurb: "Altstadt café-bar for breakfast by day, spritz by night.", extraTags: ["breakfast"] },
    { name: "Bergbrand Kaffeerösterei", rating: 4.5, blurb: "Small-batch roaster with a tasting bar in the southern old town.", extraTags: ["roastery", "specialty-coffee"] },
    { name: "Café Neumeier", rating: 4.4, blurb: "Classic St. Sebald café for Lebkuchen-adjacent afternoon Kaffee und Kuchen.", extraTags: ["cake"] },
    { name: "Golden Post", rating: 4.4, blurb: "Third-wave café in a former post office near Hallertor.", extraTags: ["specialty-coffee"] },
    { name: "Café Luftsprung", rating: 4.4, blurb: "Johannis neighbourhood café with big cakes and bigger breakfasts.", extraTags: ["breakfast", "cake"] },
  ],
  Stuttgart: [
    { name: "Grand Café Planie", rating: 4.5, blurb: "Stuttgart's belle-époque grand café on Planie, chandeliers and Sacher.", extraTags: ["historic", "cake"] },
    { name: "Café Kaiserbau", rating: 4.5, blurb: "Marienplatz corner institution where the Südans watch the trams over cake.", extraTags: ["historic", "cake"] },
    { name: "Café Moulu", rating: 4.5, blurb: "French-leaning specialty café in the Süd, filter flights and croissants.", extraTags: ["specialty-coffee"] },
    { name: "Hüftengold", rating: 4.5, blurb: "Stuttgart-West's beloved cake-and-brunch hideaway on Olgastraße.", extraTags: ["cake", "brunch"] },
    { name: "Teehaus im Weißenburgpark", rating: 4.4, blurb: "Hilltop tea house above the city with Swabian Maultaschen and views.", extraTags: ["view", "tea"] },
    { name: "Kaffeerösterei Kirsch", rating: 4.4, blurb: "Family roastery pouring Stuttgart-roasted espresso since 1950.", extraTags: ["roastery", "espresso"] },
    { name: "Café Seyffer", rating: 4.4, blurb: "Feuersee-area café and Konditorei for Black Forest cake done properly.", extraTags: ["cake"] },
    { name: "Café Da Capo", rating: 4.4, blurb: "Heslach neighbourhood classic for breakfast and strong Kaffee.", extraTags: ["breakfast"] },
  ],
};

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; country?: string };
}

/** Photon-verify "name, city, Germany" - verified coords or null. */
async function verifyCafe(
  name: string,
  city: string,
  centre: { lat: number; lng: number },
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(PHOTON_API);
  url.searchParams.set("q", `${name}, ${city}, Germany`);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  const data = await fetchJson<{ features?: PhotonFeature[] }>(url, {
    timeoutMs: 8000,
    userAgent: USER_AGENT,
    service: "photon",
  });
  for (const f of data.features ?? []) {
    const p = f.properties;
    if (normKey(p.country ?? "") !== "germany") continue;
    const featName = p.name ?? "";
    if (normKey(featName).length < 4 || normKey(name).length < 4) continue;
    if (!nameMatches(name, featName)) continue;
    const [lng, lat] = f.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (kmBetween(lat, lng, centre.lat, centre.lng) <= CITY_MATCH_KM) return { lat, lng };
  }
  return null;
}

interface Checkpoint {
  doneCities: string[];
  inserted: number;
  skippedExisting: number;
  skippedUnverified: number;
  perCity: Record<string, { inserted: number; existing: number; unverified: number }>;
  updatedAt: string;
}

async function main() {
  const db = getDb();
  const useWikipedia = await wikipediaReachable();
  console.log(
    `[cafes-de] photo backend: ${useWikipedia ? "Wikipedia REST" : "DBpedia SPARQL (Wikipedia unreachable)"}`,
  );

  let cp: Checkpoint = (!RESTART && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || {
    doneCities: [],
    inserted: 0,
    skippedExisting: 0,
    skippedUnverified: 0,
    perCity: {},
    updatedAt: "",
  };

  for (const [city, cafes] of Object.entries(CAFES)) {
    if (cp.doneCities.includes(city)) {
      console.log(`[cafes-de] SKIP ${city}, done in a previous run`);
      continue;
    }
    const stats = { inserted: 0, existing: 0, unverified: 0 };
    const geo = await geocodeCityInCountry(city, "Germany");
    if (!geo) {
      console.warn(`[cafes-de] ${city}: cannot geocode city centre, skipping city`);
      cp.perCity[city] = stats;
      cp.doneCities.push(city);
      continue;
    }
    const centre = { lat: geo.lat, lng: geo.lng };

    // Existing corpus rows in the city (for the same-name-within-1km rule).
    const existing = await db
      .select({
        name: schema.explorePlaces.name,
        lat: schema.explorePlaces.lat,
        lng: schema.explorePlaces.lng,
      })
      .from(schema.explorePlaces)
      .where(eq(schema.explorePlaces.city, city));

    // 1) verify all candidates via Photon (1 req/s)
    const verified: (CafeSpec & { lat: number; lng: number })[] = [];
    for (const cafe of cafes) {
      const nameKey = normalizeNameKey(cafe.name);
      const started = Date.now();
      try {
        const hit = await verifyCafe(cafe.name, city, centre);
        if (!hit) {
          stats.unverified += 1;
          console.log(`[cafes-de] ${city}: UNVERIFIED "${cafe.name}", skipping`);
        } else if (
          existing.some(
            (r) =>
              normalizeNameKey(r.name) === nameKey &&
              r.lat != null &&
              r.lng != null &&
              kmBetween(r.lat, r.lng, hit.lat, hit.lng) <= DEDUPE_KM,
          )
        ) {
          stats.existing += 1;
          console.log(`[cafes-de] ${city}: EXISTS "${cafe.name}" within ${DEDUPE_KM} km, skipping`);
        } else {
          verified.push({ ...cafe, ...hit });
        }
      } catch (e) {
        stats.unverified += 1;
        console.warn(
          `[cafes-de] ${city}: verify error "${cafe.name}": ${e instanceof Error ? e.message : e}`,
        );
      }
      const elapsed = Date.now() - started;
      if (elapsed < 1000) await sleep(1000 - elapsed);
    }

    // 2) photos for the verified batch
    const photos = new Map<number, { image: string; attribution: string }>();
    if (useWikipedia) {
      for (const c of verified) {
        try {
          const { hit } = await wikiPhotoForPlace(c.name, city);
          if (hit) photos.set(verified.indexOf(c), { image: hit.image, attribution: hit.attribution });
        } catch {
          /* photo optional */
        }
        await sleep(300);
      }
    } else {
      try {
        const rows = verified.map((c, i) => ({ id: i, name: c.name, city }));
        const found = await dbpediaPhotosForBatch(rows);
        for (const [i, hit] of found) photos.set(i, { image: hit.image, attribution: hit.attribution });
      } catch (e) {
        console.warn(`[cafes-de] ${city}: photo batch failed (${e instanceof Error ? e.message : e}), inserting without photos`);
      }
    }

    // 3) insert
    for (let i = 0; i < verified.length; i++) {
      const c = verified[i]!;
      const photo = photos.get(i);
      await db.insert(schema.explorePlaces).values({
        name: c.name,
        city,
        country: "Germany",
        lat: c.lat,
        lng: c.lng,
        category: "food",
        tags: ["cafe", "coffee", ...(c.extraTags ?? [])],
        styles: [],
        rating: c.rating,
        priceLevel: 2,
        description: c.blurb,
        source: "curated",
        famousEatery: true,
        ...(photo
          ? { image: photo.image, photoSource: "wikipedia", photoAttribution: photo.attribution }
          : {}),
      });
      stats.inserted += 1;
      console.log(`[cafes-de] ${city}: + "${c.name}" @ ${c.lat.toFixed(5)},${c.lng.toFixed(5)}${photo ? " (photo)" : ""}`);
    }

    cp.inserted += stats.inserted;
    cp.skippedExisting += stats.existing;
    cp.skippedUnverified += stats.unverified;
    cp.perCity[city] = stats;
    cp.doneCities.push(city);
    cp.updatedAt = new Date().toISOString();
    await cacheSet(CHECKPOINT_KEY, cp, TTL_30D);
    console.log(
      `[cafes-de] ${city} done, +${stats.inserted} inserted, ${stats.existing} existing, ${stats.unverified} unverified`,
    );
  }

  console.log(
    `\n[cafes-de] COMPLETE, ${cp.inserted} inserted, ${cp.skippedExisting} existing-skipped, ${cp.skippedUnverified} unverified-skipped`,
  );
  for (const [city, s] of Object.entries(cp.perCity)) {
    console.log(`[cafes-de]   ${city}: +${s.inserted} (${s.existing} existed, ${s.unverified} unverified)`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[cafes-de] FAILED:", e);
  process.exit(1);
});
