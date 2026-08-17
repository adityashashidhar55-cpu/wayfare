/**
 * Deep-import one city from OpenStreetMap (four themed Overpass passes:
 * culture / food-drink / nature / shopping+life) and print per-pass counts.
 *
 * Run:  npx tsx db/deep-import-city.ts "Porto"
 *       npx tsx db/deep-import-city.ts "Coimbatore" --town   (smaller caps)
 *
 * Idempotent: dedupes on osmId + normalized name against the corpus already
 * inside the city radius, so re-runs insert nothing new.
 * Data © OpenStreetMap contributors, ODbL.
 */
import { deepImportCity } from "../api/queries/coverage";

async function main() {
  const city = process.argv[2];
  if (!city) {
    console.error('usage: npx tsx db/deep-import-city.ts "City Name" [--town] [--cap N]');
    process.exit(1);
  }
  const town = process.argv.includes("--town");
  const capIdx = process.argv.indexOf("--cap");
  const capPerPass = capIdx !== -1 ? Number(process.argv[capIdx + 1]) : undefined;

  console.log(`[deep-import] ${city}, running 5 themed passes (cap ${capPerPass ?? (town ? 80 : 180)}/pass, café pass 2×)…`); // r13-cafes
  const res = await deepImportCity(city, {
    size: town ? "town" : "big",
    capPerPass,
  });
  console.log(`[deep-import] ${res.city}, ${res.country} (${res.lat.toFixed(4)}, ${res.lng.toFixed(4)})`);
  for (const [theme, r] of Object.entries(res.perPass)) {
    console.log(`  ${theme.padEnd(8)} fetched ${String(r.fetched).padStart(3)} → inserted +${r.inserted}`);
  }
  console.log(`[deep-import] TOTAL inserted +${res.inserted}, corpus within 25 km now ${res.total}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[deep-import] FAILED, ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
