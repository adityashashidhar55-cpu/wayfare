/**
 * seed-corpus-germany.ts (r16-germany) - seed German city corpora that have
 * ZERO explore_places rows. The German corpus today is only Berlin + Munich;
 * this adds the other major cities through the world seeder's own pipeline
 * (deepImportCity: 4 themed Overpass passes, osmId/name dedupe against the
 * existing corpus, batches of 50, source 'osm').
 *
 * Sizing follows db/seed-world-cities.ts capFor(pop):
 *   ≥250k pop → 180/pass, delta 0.15°   (Hamburg, Cologne, Frankfurt,
 *                                        Stuttgart, Düsseldorf, Leipzig,
 *                                        Dresden, Nuremberg)
 *   ≥50k      → 80/pass, delta 0.1°     (Heidelberg)
 *
 * Checkpointed in api_cache ('seed:corpus-germany') after every city - 
 * sandbox-wipe safe; re-run resumes. deepImportCity is idempotent, so
 * re-running a finished city inserts nothing (skip check at ≥30 rows
 * within 25 km short-circuits it anyway).
 *
 * Run:  npx tsx db/seed-corpus-germany.ts [--restart]
 * Bg:   nohup npx tsx db/seed-corpus-germany.ts > /tmp/seed-corpus-de.log 2>&1 &
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import {
  cacheGet,
  cacheSet,
  corpusPointsNear,
  deepImportCity,
  sleep,
} from "../api/queries/coverage";

const CHECKPOINT_KEY = "seed:corpus-germany";
const BETWEEN_CITIES_MS = 1_500;
const SKIP_THRESHOLD = 30; // rows within 25 km = already covered
const RESTART = process.argv.includes("--restart");

interface CitySpec {
  name: string;
  lat: number;
  lng: number;
  pop: number;
}

/** Mission order: required seven first, budget-optional two last. */
const CITIES: CitySpec[] = [
  { name: "Hamburg", lat: 53.5511, lng: 9.9937, pop: 1_900_000 },
  { name: "Cologne", lat: 50.9375, lng: 6.9603, pop: 1_100_000 },
  { name: "Frankfurt", lat: 50.1109, lng: 8.6821, pop: 800_000 },
  { name: "Dresden", lat: 51.0504, lng: 13.7373, pop: 560_000 },
  { name: "Stuttgart", lat: 48.7758, lng: 9.1829, pop: 630_000 },
  { name: "Düsseldorf", lat: 51.2277, lng: 6.7735, pop: 650_000 },
  { name: "Leipzig", lat: 51.3397, lng: 12.3731, pop: 600_000 },
  { name: "Nuremberg", lat: 49.4521, lng: 11.0767, pop: 520_000 },
  { name: "Heidelberg", lat: 49.3988, lng: 8.6724, pop: 160_000 },
];

/** db/seed-world-cities.ts capFor(pop) - same adaptive sizing. */
function capFor(pop: number): { capPerPass: number; size: "big" | "town"; deltaDeg: number } {
  if (pop >= 250_000) return { capPerPass: 180, size: "big", deltaDeg: 0.15 };
  if (pop >= 50_000) return { capPerPass: 80, size: "town", deltaDeg: 0.1 };
  return { capPerPass: 50, size: "town", deltaDeg: 0.08 };
}

interface Checkpoint {
  idx: number; // last completed city index
  inserted: number;
  skipped: number;
  failed: number;
  perCity: Record<string, { inserted: number; total: number; status: "ok" | "skipped" | "failed" }>;
  updatedAt: string;
}

async function main() {
  let cp: Checkpoint = (!RESTART && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || {
    idx: -1,
    inserted: 0,
    skipped: 0,
    failed: 0,
    perCity: {},
    updatedAt: "",
  };
  if (cp.idx >= 0) {
    console.log(
      `[corpus-de] resuming after ${CITIES[cp.idx]?.name} (idx ${cp.idx}; +${cp.inserted} so far, ${cp.skipped} skipped, ${cp.failed} failed)`,
    );
  }
  console.log(`[corpus-de] ${CITIES.length} German cities to seed${RESTART ? " (--restart)" : ""}`);

  for (let idx = cp.idx + 1; idx < CITIES.length; idx++) {
    const city = CITIES[idx]!;
    const label = `${city.name} (#${idx + 1}/${CITIES.length}, pop ${(city.pop / 1e6).toFixed(2)}M)`;
    try {
      const near = await corpusPointsNear(city.lat, city.lng, 25);
      if (near.length >= SKIP_THRESHOLD) {
        cp.skipped += 1;
        cp.perCity[city.name] = { inserted: 0, total: near.length, status: "skipped" };
        console.log(`[corpus-de] SKIP ${label}, corpus already ${near.length} within 25 km`);
      } else {
        const { capPerPass, size, deltaDeg } = capFor(city.pop);
        const res = await deepImportCity(city.name, {
          geo: { lat: city.lat, lng: city.lng, country: "Germany" },
          capPerPass,
          size,
          deltaDeg,
          throttleMs: 1_500,
        });
        cp.inserted += res.inserted;
        cp.perCity[city.name] = { inserted: res.inserted, total: res.total, status: "ok" };
        console.log(
          `[corpus-de] OK ${label}, +${res.inserted} places (corpus within 25 km now ${res.total}); per-pass: ` +
            Object.entries(res.perPass)
              .map(([k, v]) => `${k}:${v.inserted}/${v.fetched}`)
              .join(" "),
        );
      }
    } catch (e) {
      cp.failed += 1;
      cp.perCity[city.name] = { inserted: 0, total: 0, status: "failed" };
      console.error(`[corpus-de] FAIL ${label}, ${e instanceof Error ? e.message : e} (continuing)`);
    }
    cp.idx = idx;
    cp.updatedAt = new Date().toISOString();
    await cacheSet(CHECKPOINT_KEY, cp, 7 * 24 * 60 * 60 * 1000);
    await sleep(BETWEEN_CITIES_MS);
  }

  console.log(
    `\n[corpus-de] COMPLETE, +${cp.inserted} places, ${cp.skipped} cities skipped, ${cp.failed} failed`,
  );
  for (const [name, s] of Object.entries(cp.perCity)) {
    console.log(`[corpus-de]   ${name}: +${s.inserted} (total ${s.total}) [${s.status}]`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[corpus-de] FAILED:", e);
  process.exit(1);
});
