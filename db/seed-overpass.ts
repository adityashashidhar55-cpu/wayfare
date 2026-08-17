/**
 * Bulk import of real places from OpenStreetMap (Overpass) for a fixed list of
 * cities. Run with: npx tsx db/seed-overpass.ts
 * Idempotent: dedupes on osmId + name-within-city, so re-runs insert nothing.
 * Data © OpenStreetMap contributors, ODbL.
 */
import { importCityPlaces } from "../api/queries/overpass";

const CITIES = [
  "Tokyo",
  "Kyoto",
  "Osaka",
  "Paris",
  "London",
  "Rome",
  "Barcelona",
  "Lisbon",
  "Amsterdam",
  "Berlin",
  "Prague",
  "Vienna",
  "Budapest",
  "Athens",
  "Istanbul",
  "Marrakech",
  "Cairo",
  "Cape Town",
  "Dubai",
  "New York",
  "San Francisco",
  "Los Angeles",
  "Chicago",
  "Mexico City",
  "Buenos Aires",
  "Rio de Janeiro",
  "Cusco",
  "Bangkok",
  "Chiang Mai",
  "Singapore",
  "Hong Kong",
  "Seoul",
  "Sydney",
  "Melbourne",
  "Delhi",
  "Mumbai",
  "Kathmandu",
  "Hanoi",
  "Ho Chi Minh City",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function importCity(city: string, endpointOffset: number) {
  const res = await importCityPlaces(city, endpointOffset);
  console.log(`[seed-overpass] ${city}: +${res.inserted} inserted (city total ${res.total})`);
  return res;
}

async function main() {
  const totals = new Map<string, { inserted: number; total: number }>();
  let failed: string[] = [];
  let endpointOffset = 0;

  for (const city of CITIES) {
    try {
      totals.set(city, await importCity(city, endpointOffset));
    } catch (e) {
      failed.push(city);
      console.error(`[seed-overpass] ${city}: FAILED, ${e instanceof Error ? e.message : String(e)}`);
    }
    endpointOffset = (endpointOffset + 1) % 2; // rotate Overpass endpoints
    await sleep(3000); // rate-limit between Overpass calls
  }

  if (failed.length > 0) {
    console.log(`[seed-overpass] retrying ${failed.length} failed cities: ${failed.join(", ")}`);
    const retrying = failed;
    failed = [];
    for (const city of retrying) {
      try {
        totals.set(city, await importCity(city, endpointOffset));
      } catch (e) {
        failed.push(city);
        console.error(
          `[seed-overpass] ${city}: FAILED again, ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      endpointOffset = (endpointOffset + 1) % 2;
      await sleep(3000);
    }
  }

  let grandTotal = 0;
  let totalInserted = 0;
  console.log("\n[seed-overpass] ── per-city totals ──");
  for (const city of CITIES) {
    const t = totals.get(city);
    if (t) {
      console.log(`  ${city}: ${t.total} places (+${t.inserted} this run)`);
      grandTotal += t.total;
      totalInserted += t.inserted;
    } else {
      console.log(`  ${city}: FAILED`);
    }
  }
  console.log(
    `[seed-overpass] done: ${totalInserted} inserted this run, ${grandTotal} places across ${totals.size} cities` +
      (failed.length ? `, still failing: ${failed.join(", ")}` : ""),
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
