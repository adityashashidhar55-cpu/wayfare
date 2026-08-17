/**
 * World city seeder - maps the top cities of EVERY country from OpenStreetMap.
 *
 * Run:            npx tsx db/seed-world-cities.ts
 * Background:     nohup npx tsx db/seed-world-cities.ts > /tmp/seed-world.log 2>&1 &
 *
 * Ordering (mission K):
 *   pass 1 - for EVERY country, its capital + top-4 cities (directory idx 0-4)
 *   pass 2 - deepen every country to its full top-25 (directory idx 5-24)
 *
 * RESUMABLE: progress lives in api_cache under 'seed:world:checkpoint'
 * ({pass, countryIdx, cityIdx, …}), written after every city, so a restart
 * (sandbox wipes local files) picks up exactly where the last city finished.
 * Delete that key (or run with RESET=1) to start over.
 *
 * Per city: skipped when the corpus already holds ≥ 30 approved places within
 * 25 km; otherwise deepImportCity runs its four themed passes with adaptive
 * caps (big city 180/pass, town 80, tiny town 50). Overpass calls are paced
 * (~1.5 s between passes/cities), mirrors rotate, and 429/5xx back off 30 s - 
 * a failed city is logged and the run CONTINUES, never aborts.
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { WORLD_COUNTRIES } from "../api/lib/world-cities";
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

const CHECKPOINT_KEY = "seed:world:checkpoint";
/** corpus size within 25 km that marks a city as already covered */
const SKIP_THRESHOLD = 30;
const BETWEEN_CITIES_MS = 1_500;

interface Checkpoint {
  pass: 1 | 2;
  countryIdx: number;
  cityIdx: number;
  done: number;
  mapped: number;
  skipped: number;
  failed: number;
  inserted: number;
  /** cities that failed (Overpass outages) - retried once at the end of the run */
  failedList: { countryIdx: number; cityIdx: number }[];
  /** true once the end-of-run retry sweep has run */
  retried?: boolean;
  updatedAt: string;
}

interface WorkItem {
  pass: 1 | 2;
  countryIdx: number;
  cityIdx: number;
}

/** Flatten the two passes into one ordered work list. */
function buildWorkList(): WorkItem[] {
  const list: WorkItem[] = [];
  for (const pass of [1, 2] as const) {
    WORLD_COUNTRIES.forEach((c, countryIdx) => {
      const start = pass === 1 ? 0 : 5;
      const end = pass === 1 ? Math.min(5, c.cities.length) : c.cities.length;
      for (let cityIdx = start; cityIdx < end; cityIdx++) {
        list.push({ pass, countryIdx, cityIdx });
      }
    });
  }
  return list;
}

/**
 * Adaptive per-pass cap + bbox span from directory population
 * (0 = unknown → tiny). Small towns get tighter boxes: faster queries and
 * the same effective coverage of the settlement area.
 */
function capFor(pop: number): { capPerPass: number; size: "big" | "town"; deltaDeg: number } {
  if (pop >= 250_000) return { capPerPass: 180, size: "big", deltaDeg: 0.15 };
  if (pop >= 50_000) return { capPerPass: 80, size: "town", deltaDeg: 0.1 };
  return { capPerPass: 50, size: "town", deltaDeg: 0.08 };
}

function after(cp: Checkpoint, item: WorkItem): boolean {
  // work item comes strictly after the checkpoint position
  if (item.pass !== cp.pass) return item.pass > cp.pass;
  if (item.countryIdx !== cp.countryIdx) return item.countryIdx > cp.countryIdx;
  return item.cityIdx > cp.cityIdx;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[seed-world] start ${startedAt}, ${WORLD_COUNTRIES.length} countries`);

  const work = buildWorkList();
  console.log(`[seed-world] work list: ${work.length} city imports (2 passes)`);

  const reset = process.env.RESET === "1";
  let cp = (!reset && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || null;
  if (cp) {
    console.log(
      `[seed-world] resuming at pass ${cp.pass} country#${cp.countryIdx} city#${cp.cityIdx} ` +
        `(done ${cp.done}, mapped ${cp.mapped}, skipped ${cp.skipped}, failed ${cp.failed}, +${cp.inserted} places)`,
    );
  } else {
    cp = {
      pass: 1,
      countryIdx: -1,
      cityIdx: -1,
      done: 0,
      mapped: 0,
      skipped: 0,
      failed: 0,
      inserted: 0,
      failedList: [],
      updatedAt: startedAt,
    };
  }
  cp.failedList ??= [];

  // In-memory corpus index - loaded once, topped up after each import, so the
  // skip check never re-scans explore_places per city.
  const index: PointIndex = makePointIndex(await corpusPoints());
  let lastLoggedDone = 0;

  const save = () => cacheSet(CHECKPOINT_KEY, cp!, 7 * 24 * 60 * 60 * 1000);

  /** Import (or skip) one work item; records stats + failures into cp. */
  async function processItem(item: WorkItem, isRetry = false) {
    const country = WORLD_COUNTRIES[item.countryIdx]!;
    const cityEntry = country.cities[item.cityIdx]!;
    const label = `${cityEntry.name}, ${country.name} (p${item.pass} ${item.countryIdx}.${item.cityIdx})${isRetry ? " [retry]" : ""}`;

    try {
      // skip check only possible when the directory knows where the city sits
      if (cityEntry.lat != null && cityEntry.lng != null) {
        const have = countWithin(index, cityEntry.lat, cityEntry.lng, 25);
        if (have >= SKIP_THRESHOLD) {
          cp!.skipped += 1;
          console.log(`[seed-world] SKIP ${label}, corpus already ${have}`);
          return;
        }
      }
      const { capPerPass, size, deltaDeg } = capFor(cityEntry.pop);
      const res = await deepImportCity(cityEntry.name, {
        geo:
          cityEntry.lat != null && cityEntry.lng != null
            ? { lat: cityEntry.lat, lng: cityEntry.lng, country: country.name }
            : undefined, // capital with unknown coords - geocode inside
        capPerPass,
        size,
        deltaDeg,
        throttleMs: BETWEEN_CITIES_MS,
      });
      cp!.done += 1;
      cp!.inserted += res.inserted;
      if (res.total >= 12) cp!.mapped += 1;
      console.log(
        `[seed-world] OK ${label}, +${res.inserted} (total ${res.total}) ` +
          `[culture +${res.perPass.culture.inserted}, food +${res.perPass.food.inserted}, ` +
          `nature +${res.perPass.nature.inserted}, life +${res.perPass.life.inserted}]`,
      );
      // fold the freshly imported points into the local index
      addToPointIndex(index, await corpusPointsNear(res.lat, res.lng, 25));
    } catch (e) {
      cp!.failed += 1;
      if (!isRetry) cp!.failedList.push({ countryIdx: item.countryIdx, cityIdx: item.cityIdx });
      console.error(
        `[seed-world] FAIL ${label}, ${e instanceof Error ? e.message : String(e)} (continuing)`,
      );
    }
  }

  for (const item of work) {
    if (!after(cp, item)) continue; // already done in a previous run
    await processItem(item);

    cp.pass = item.pass;
    cp.countryIdx = item.countryIdx;
    cp.cityIdx = item.cityIdx;
    cp.updatedAt = new Date().toISOString();
    // checkpoint TTL 7 days - the run should finish well within that
    await save();

    if (cp.done > 0 && cp.done % 10 === 0 && cp.done !== lastLoggedDone) {
      lastLoggedDone = cp.done;
      console.log(
        `[seed-world] progress: done ${cp.done}/${work.length}, mapped ${cp.mapped}, ` +
          `skipped ${cp.skipped}, failed ${cp.failed}, +${cp.inserted} places, ${cp.updatedAt}`,
      );
    }
    await sleep(BETWEEN_CITIES_MS);
  }

  // End-of-run sweep: one retry for every city that failed (Overpass outages
  // are transient). Skips apply again, so already-covered cities cost nothing.
  if (cp.failedList.length > 0 && !cp.retried) {
    console.log(`[seed-world] retry sweep: ${cp.failedList.length} failed cities`);
    const retrying = cp.failedList;
    cp.failedList = [];
    for (const f of retrying) {
      await processItem({ pass: cp.pass, countryIdx: f.countryIdx, cityIdx: f.cityIdx }, true);
      cp.updatedAt = new Date().toISOString();
      await save();
      await sleep(BETWEEN_CITIES_MS);
    }
    cp.retried = true;
    cp.updatedAt = new Date().toISOString();
    await save();
  }

  console.log(
    `[seed-world] COMPLETE, mapped ${cp.mapped} new cities, skipped ${cp.skipped} already-covered, ` +
      `failed ${cp.failed}, inserted ${cp.inserted} places total`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-world] fatal", e);
  process.exit(1);
});
