/**
 * seed-suchindram.ts (r18-stories) - deep-import Suchindram (Tamil Nadu,
 * India; home of the Thanumalayan Temple) into the explore_places corpus,
 * then apply any curated place-stories files that now match.
 *
 * Uses the SAME pipeline as the world/corpus seeders: deepImportCity() runs
 * the five themed Overpass passes over the town bbox, deduped against the
 * corpus (idempotent - re-runs insert nothing). Coords are pinned (no
 * Photon needed) and country forced to 'India'; caps come from
 * capFor(metroPop) - Suchindram is a small town of ~12k, so it imports as
 * "town" (50/pass, 0.08° bbox).
 *
 * Afterwards the place-stories import runs so db/data/place-stories-india.json
 * stories for Suchindram attach to the fresh rows (skipped gracefully when
 * no place-stories-*.json files exist).
 *
 * Run:  npx tsx db/seed-suchindram.ts
 * Data © OpenStreetMap contributors, ODbL.
 */
import { deepImportCity } from "../api/queries/coverage";
import { importStories, loadStoryFiles } from "./import-place-stories";

const TOWN = { name: "Suchindram", lat: 8.1544, lng: 77.467, metroPop: 12_000 };

/** Adaptive per-pass cap + bbox span from metro population (world-seeder rule). */
function capFor(pop: number): { capPerPass: number; size: "big" | "town"; deltaDeg: number } {
  if (pop >= 250_000) return { capPerPass: 180, size: "big", deltaDeg: 0.15 };
  if (pop >= 50_000) return { capPerPass: 80, size: "town", deltaDeg: 0.1 };
  return { capPerPass: 50, size: "town", deltaDeg: 0.08 };
}

async function main() {
  const { capPerPass, size, deltaDeg } = capFor(TOWN.metroPop);
  console.log(
    `[seed-suchindram] deep-import ${TOWN.name}, India (${TOWN.lat},${TOWN.lng}), ` +
      `size=${size} cap=${capPerPass}/pass delta=${deltaDeg}°`,
  );
  const res = await deepImportCity(TOWN.name, {
    geo: { lat: TOWN.lat, lng: TOWN.lng, country: "India" },
    capPerPass,
    size,
    deltaDeg,
  });
  console.log(
    `[seed-suchindram] OK, +${res.inserted} places (corpus total ${res.total}) ` +
      `[culture +${res.perPass.culture?.inserted ?? 0}, food +${res.perPass.food?.inserted ?? 0}, ` +
      `cafe +${res.perPass.cafe?.inserted ?? 0}, nature +${res.perPass.nature?.inserted ?? 0}, ` +
      `life +${res.perPass.life?.inserted ?? 0}]`,
  );

  if (!loadStoryFiles().length) {
    console.log("[seed-suchindram] no place-stories-*.json files, skipping story import");
  } else {
    const summary = await importStories();
    console.log(
      `[seed-suchindram] stories, updated ${summary.updated}, inserted ${summary.inserted}, ` +
        `skipped ${summary.skipped}, failed ${summary.failed}`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-suchindram] fatal", e);
  process.exit(1);
});
