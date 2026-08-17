/**
 * India coverage wave (r11-apifix): deep-import the top ~40 Indian cities
 * into the explore_places corpus.
 *
 * For each city: skip when the corpus already holds ≥ 60 approved places
 * within 25 km ("rich"), else run the FOUR themed Overpass passes of
 * `deepImportCity` (api/queries/coverage.ts). Per-city counts are logged.
 * Idempotent - re-runs skip rich cities and re-attempt the rest (the deep
 * import itself dedupes on osmId + normalized name).
 *
 * Run:  npx tsx db/seed-india.ts            (full wave)
 *       npx tsx db/seed-india.ts --only=Goa,Jaipur
 *       npx tsx db/seed-india.ts --rich=60  (override the richness threshold)
 *
 * Politeness: 1.5 s between a city's four passes (deepImportCity default),
 * 4 s between cities; postCoverageQuery rotates public Overpass mirrors and
 * backs off 30 s on 429/502/503/504. Data © OpenStreetMap contributors, ODbL.
 */
import { corpusCountNear, deepImportCity, sleep } from "../api/queries/coverage";

/** Top ~40 Indian travel cities (mission list). */
export const INDIA_WAVE_CITIES = [
  "Mumbai",
  "Delhi",
  "Jaipur",
  "Agra",
  "Varanasi",
  "Udaipur",
  "Jodhpur",
  "Goa",
  "Kochi",
  "Munnar",
  "Alleppey",
  "Chennai",
  "Pondicherry",
  "Bengaluru",
  "Mysuru",
  "Hampi",
  "Kolkata",
  "Darjeeling",
  "Shimla",
  "Manali",
  "Rishikesh",
  "Amritsar",
  "Ahmedabad",
  "Hyderabad",
  "Pune",
  "Thiruvananthapuram",
  "Madurai",
  "Rameswaram",
  "Kanyakumari",
  "Ooty",
  "Kodaikanal",
  "Coimbatore",
  "Tirupati",
  "Bhopal",
  "Indore",
  "Lucknow",
  "Chandigarh",
  "Srinagar",
  "Leh",
  "Guwahati",
] as const;

const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const richArg = process.argv.find((a) => a.startsWith("--rich="))?.split("=")[1];
const RICH_THRESHOLD = richArg ? Number(richArg) : 60;
const cities = onlyArg
  ? onlyArg.split(",").map((s) => s.trim()).filter(Boolean)
  : [...INDIA_WAVE_CITIES];

const startedAt = Date.now();
let waveInserted = 0;
let done = 0;
let skipped = 0;
let failed = 0;

console.log(
  `[seed-india] wave of ${cities.length} cities, skip when ≥ ${RICH_THRESHOLD} places within 25 km`,
);

for (const city of cities) {
  const t0 = Date.now();
  // Always bias the geocoder with the country - bare "Goa" resolves to
  // Goa, Philippines on Photon; "Pondicherry" etc. are unambiguous but the
  // suffix is harmless for them.
  const query = `${city}, India`;
  try {
    // Rich cities skip BEFORE any Overpass traffic (approved places in radius).
    const before = await corpusCountNearCity(query);
    if (before != null && before >= RICH_THRESHOLD) {
      skipped++;
      done++;
      console.log(
        `[seed-india] ${done}/${cities.length} ${city} · SKIP (already rich: ${before} places within 25 km)`,
      );
      continue;
    }
    const res = await deepImportCity(query, {});
    waveInserted += res.inserted;
    done++;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const passLine = Object.entries(res.perPass)
      .map(([theme, r]) => `${theme} +${r.inserted}/${r.fetched}`)
      .join(" · ");
    console.log(
      `[seed-india] ${done}/${cities.length} ${res.city}, ${res.country}, inserted +${res.inserted} ` +
        `(corpus now ${res.total}) in ${secs}s\n    ${passLine}`,
    );
  } catch (e) {
    failed++;
    done++;
    console.error(
      `[seed-india] ${done}/${cities.length} ${city} · FAILED (continuing): ${e instanceof Error ? e.message : e}`,
    );
  }
  await sleep(4_000); // polite pacing between cities
}

const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
console.log(
  `[seed-india] DONE in ${mins} min, ${cities.length} cities: ${skipped} skipped rich, ${failed} failed, +${waveInserted} places inserted`,
);
process.exit(failed ? 1 : 0);

/** corpusCountNear needs coords - geocode happens inside deepImportCity too,
 *  so this helper geocodes once via the shared (cached) geocoder. */
async function corpusCountNearCity(city: string): Promise<number | null> {
  const { geocodeCity, titleCase } = await import("../api/queries/overpass");
  const geo = await geocodeCity(titleCase(city));
  if (!geo) return null; // cannot check richness - attempt the import anyway
  return corpusCountNear(geo.lat, geo.lng, 25);
}
