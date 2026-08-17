/**
 * seed-corpus-france.ts (r16-france) - bootstrap the explore_places corpus for
 * the major French cities the corpus is MISSING (today France = Paris only,
 * 818 rows; Lyon/Marseille/Nice/Bordeaux/Strasbourg/Toulouse/Nantes/Lille/
 * Montpellier have zero).
 *
 * Uses the SAME pipeline as the world seeder (db/seed-world-cities.ts):
 * deepImportCity() runs the five themed Overpass passes (culture, food, cafe,
 * nature, life) over the city bbox, deduped against the corpus, source='osm'.
 * City coords are pinned (no Photon needed) and country forced to 'France';
 * per-pass caps come from capFor(metroPop) - every one of these is ≥ 250k
 * metro, so they all import as "big" (180/pass, 360 for the café pass).
 *
 * Skip behaviour matches the world seeder: a city already holding ≥ 30 corpus
 * places within 25 km is skipped (idempotent re-runs cost nothing).
 *
 * RESUMABLE: progress checkpoints to api_cache ('seed:corpus-france') after
 * every city (sandbox wipes local files, not the DB); re-run to resume.
 * RESET=1 starts over. Failed cities get one end-of-run retry sweep.
 *
 * Run:    npx tsx db/seed-corpus-france.ts
 * Bg:     nohup npx tsx db/seed-corpus-france.ts > /tmp/seed-corpus-fr.log 2>&1 &
 * Data © OpenStreetMap contributors, ODbL.
 */
import {
  addToPointIndex,
  cacheGet,
  cacheSet,
  corpusPoints,
  corpusPointsNear,
  countWithin,
  deepImportCity,
  makePointIndex,
  sleep,
  type PointIndex,
} from "../api/queries/coverage";

const CHECKPOINT_KEY = "seed:corpus-france";
const SKIP_THRESHOLD = 30; // corpus rows within 25 km that mark a city covered
const BETWEEN_CITIES_MS = 1_500;
const TTL_7D = 7 * 24 * 60 * 60 * 1000;

/** Metro population drives capFor() sizing (world-seeder convention). */
interface FrenchCity {
  name: string;
  lat: number;
  lng: number;
  metroPop: number;
}
// Ordered per mission: Lyon, Marseille, Nice, Bordeaux, Strasbourg, Toulouse,
// Nantes first; Lille + Montpellier (budget permitting) at the tail.
const CITIES: FrenchCity[] = [
  { name: "Lyon", lat: 45.764, lng: 4.8357, metroPop: 1_700_000 },
  { name: "Marseille", lat: 43.2965, lng: 5.3698, metroPop: 1_600_000 },
  { name: "Nice", lat: 43.7102, lng: 7.262, metroPop: 1_000_000 },
  { name: "Bordeaux", lat: 44.8378, lng: -0.5792, metroPop: 800_000 },
  { name: "Strasbourg", lat: 48.5734, lng: 7.7521, metroPop: 500_000 },
  { name: "Toulouse", lat: 43.6047, lng: 1.4442, metroPop: 1_000_000 },
  { name: "Nantes", lat: 47.2184, lng: -1.5536, metroPop: 700_000 },
  { name: "Lille", lat: 50.6292, lng: 3.0573, metroPop: 1_000_000 },
  { name: "Montpellier", lat: 43.6108, lng: 3.8767, metroPop: 500_000 },
];

/** Adaptive per-pass cap + bbox span from metro population (world-seeder rule). */
function capFor(pop: number): { capPerPass: number; size: "big" | "town"; deltaDeg: number } {
  if (pop >= 250_000) return { capPerPass: 180, size: "big", deltaDeg: 0.15 };
  if (pop >= 50_000) return { capPerPass: 80, size: "town", deltaDeg: 0.1 };
  return { capPerPass: 50, size: "town", deltaDeg: 0.08 };
}

interface Checkpoint {
  idx: number; // last completed CITIES index
  done: number;
  skipped: number;
  failed: number;
  inserted: number;
  byCity: Record<string, number>; // city → rows inserted
  failedList: number[];
  retried?: boolean;
  updatedAt: string;
}

async function main() {
  const reset = process.env.RESET === "1";
  let cp = (!reset && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || null;
  if (cp) {
    console.log(
      `[seed-corpus-fr] resuming after idx ${cp.idx} (done ${cp.done}, skipped ${cp.skipped}, failed ${cp.failed}, +${cp.inserted})`,
    );
  } else {
    cp = { idx: -1, done: 0, skipped: 0, failed: 0, inserted: 0, byCity: {}, failedList: [], updatedAt: "" };
  }
  cp.failedList ??= [];
  cp.byCity ??= {};

  // In-memory corpus index - loaded once, topped up after each import.
  const index: PointIndex = makePointIndex(await corpusPoints());
  const save = () => cacheSet(CHECKPOINT_KEY, cp!, TTL_7D);

  async function processCity(idx: number, isRetry = false) {
    const c = CITIES[idx]!;
    const label = `${c.name}, France (#${idx + 1}/${CITIES.length})${isRetry ? " [retry]" : ""}`;
    try {
      const have = countWithin(index, c.lat, c.lng, 25);
      if (have >= SKIP_THRESHOLD) {
        cp!.skipped += 1;
        cp!.byCity[c.name] = cp!.byCity[c.name] ?? 0;
        console.log(`[seed-corpus-fr] SKIP ${label}, corpus already ${have}`);
        return;
      }
      const { capPerPass, size, deltaDeg } = capFor(c.metroPop);
      const res = await deepImportCity(c.name, {
        geo: { lat: c.lat, lng: c.lng, country: "France" },
        capPerPass,
        size,
        deltaDeg,
        throttleMs: BETWEEN_CITIES_MS,
      });
      cp!.done += 1;
      cp!.inserted += res.inserted;
      cp!.byCity[c.name] = (cp!.byCity[c.name] ?? 0) + res.inserted;
      console.log(
        `[seed-corpus-fr] OK ${label}, +${res.inserted} (total ${res.total}) ` +
          `[culture +${res.perPass.culture?.inserted ?? 0}, food +${res.perPass.food?.inserted ?? 0}, ` +
          `cafe +${res.perPass.cafe?.inserted ?? 0}, nature +${res.perPass.nature?.inserted ?? 0}, ` +
          `life +${res.perPass.life?.inserted ?? 0}]`,
      );
      addToPointIndex(index, await corpusPointsNear(res.lat, res.lng, 25));
    } catch (e) {
      cp!.failed += 1;
      if (!isRetry) cp!.failedList.push(idx);
      console.error(`[seed-corpus-fr] FAIL ${label}, ${e instanceof Error ? e.message : String(e)} (continuing)`);
    }
  }

  for (let idx = 0; idx < CITIES.length; idx++) {
    if (idx <= cp.idx) continue; // finished in a previous run
    await processCity(idx);
    cp.idx = idx;
    cp.updatedAt = new Date().toISOString();
    await save();
    await sleep(BETWEEN_CITIES_MS);
  }

  // One retry sweep for cities that failed (transient Overpass outages).
  if (cp.failedList.length > 0 && !cp.retried) {
    console.log(`[seed-corpus-fr] retry sweep: ${cp.failedList.length} failed cities`);
    const retrying = cp.failedList;
    cp.failedList = [];
    for (const idx of retrying) {
      await processCity(idx, true);
      cp.updatedAt = new Date().toISOString();
      await save();
      await sleep(BETWEEN_CITIES_MS);
    }
    cp.retried = true;
    await save();
  }

  console.log("\n[seed-corpus-fr] ===== inserted per city =====");
  for (const c of CITIES) console.log(`  ${c.name.padEnd(12)} +${cp.byCity[c.name] ?? 0}`);
  console.log(
    `[seed-corpus-fr] COMPLETE, imported into ${cp.done} cities, skipped ${cp.skipped} already-covered, ` +
      `failed ${cp.failed}, +${cp.inserted} places total`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-corpus-fr] fatal", e);
  process.exit(1);
});
