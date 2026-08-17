/**
 * Café backfill wave (r13-cafes) - top up café coverage in the biggest corpus
 * cities. User report: "Cafes and lot of stuff are missing even in major
 * cities" (baseline: Paris 0, New York 0, Amsterdam 0, Bengaluru 0 cafés).
 *
 * For the top ~60 world cities by corpus size (GROUP BY city,country HAVING
 * count(*) >= 100, ordered) - plus Bengaluru, the reporter's focus - count
 * cafés within 15 km of the city centroid (tags cafe|coffee, the vocabulary
 * both importers write and the UI's Cafés chip matches). Cities under
 * --min-cafes (default 40) get a café-focused Overpass import:
 * amenity=cafe|juice_bar + cuisine=coffee_shop within 15 km, cap 400, through
 * the coverage conventions (mirror rotation + 30 s backoff via
 * postCoverageQuery, osmId + normalized-name dedupe against everything
 * already inside the radius, batches of 50, source 'osm').
 *
 * Idempotent: dedupe means re-runs insert nothing; progress checkpoints to
 * api_cache ('seed:cafes:checkpoint') after every city so a restart resumes
 * where the last city finished (sandbox wipes local files, not the DB).
 *
 * Run:    npx tsx db/seed-cafes.ts                  # full wave
 *         npx tsx db/seed-cafes.ts --city "Paris"   # one city
 *         npx tsx db/seed-cafes.ts --dry-run        # counts only, no imports
 *         npx tsx db/seed-cafes.ts --reset          # ignore checkpoint
 * Bg:     nohup npx tsx db/seed-cafes.ts > /tmp/seed-cafes.log 2>&1 &
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../api/queries/connection";
import {
  cacheGet,
  cacheSet,
  kmBetween,
  normalizeCoverageElement,
  postCoverageQuery,
  radiusBbox,
  sleep,
} from "../api/queries/coverage";

const CHECKPOINT_KEY = "seed:cafes:checkpoint";
const BETWEEN_CITIES_MS = 2_000;

interface CityRow {
  city: string;
  country: string;
  n: number;
}

interface Checkpoint {
  idx: number; // last completed work-list index
  done: number;
  skipped: number;
  failed: number;
  imported: number; // cafés inserted across the wave
  updatedAt: string;
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}
const has = (flag: string) => process.argv.includes(flag);

/** Café-focused Overpass query around a point (r13-cafes). */
function buildCafeQuery(lat: number, lng: number, radiusM: number, cap: number): string {
  const around = `(around:${radiusM},${lat},${lng})`;
  return `[out:json][timeout:40];
(
  node["amenity"~"^(cafe|juice_bar)$"]${around};
  node["cuisine"~"coffee_shop"]${around};
  way["amenity"~"^(cafe|juice_bar)$"]${around};
  way["cuisine"~"coffee_shop"]${around};
);
out center tags ${cap};`;
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const isCafeTags = (tags: string[] | null) =>
  (tags ?? []).some((t) => t === "cafe" || t === "coffee");

async function main() {
  const limit = Number(arg("--limit") ?? 60);
  const radiusKm = Number(arg("--radius") ?? 15);
  const minCafes = Number(arg("--min-cafes") ?? 40);
  const cap = Number(arg("--cap") ?? 400);
  const onlyCity = arg("--city");
  const dryRun = has("--dry-run");
  const db = getDb();

  // ── work list: top corpus cities (+ Bengaluru, the reporter's city) ──────
  let cities: CityRow[];
  if (onlyCity) {
    const res = await db.execute(sql`
      SELECT city, country, COUNT(*) AS n FROM explore_places
      WHERE city = ${onlyCity} GROUP BY city, country ORDER BY n DESC LIMIT 1`);
    cities = (Array.isArray(res) ? res[0] : (res as { rows: CityRow[] }).rows) as CityRow[];
    if (cities.length === 0) {
      console.error(`[seed-cafes] city not in corpus: ${onlyCity}`);
      process.exit(1);
    }
  } else {
    const res = await db.execute(sql`
      SELECT city, country, COUNT(*) AS n FROM explore_places
      GROUP BY city, country HAVING n >= 100 ORDER BY n DESC LIMIT ${limit}`);
    cities = (Array.isArray(res) ? res[0] : (res as { rows: CityRow[] }).rows) as CityRow[];
    if (!cities.some((c) => c.city === "Bengaluru" && c.country === "India")) {
      cities.push({ city: "Bengaluru", country: "India", n: 0 }); // user focus - always included
    }
  }
  console.log(
    `[seed-cafes] ${cities.length} cities, radius ${radiusKm} km, min ${minCafes} cafés, cap ${cap}${dryRun ? " (DRY RUN)" : ""}`,
  );

  // ── resume checkpoint ────────────────────────────────────────────────────
  // --city runs a one-off import: the wave's positional checkpoint doesn't apply
  let cp = (!onlyCity && !has("--reset") && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || null;
  if (cp) {
    console.log(
      `[seed-cafes] resuming after idx ${cp.idx} (done ${cp.done}, skipped ${cp.skipped}, failed ${cp.failed}, +${cp.imported} cafés)`,
    );
  } else {
    cp = { idx: -1, done: 0, skipped: 0, failed: 0, imported: 0, updatedAt: "" };
  }

  for (let idx = 0; idx < cities.length; idx++) {
    if (idx <= cp.idx) continue; // finished in a previous run
    const { city, country } = cities[idx]!;
    const label = `${city}, ${country} (#${idx + 1}/${cities.length})`;
    try {
      // corpus rows for the city label → centroid (center for the 15 km circle)
      const homeRows = await db
        .select({ lat: schema.explorePlaces.lat, lng: schema.explorePlaces.lng })
        .from(schema.explorePlaces)
        .where(
          and(eq(schema.explorePlaces.city, city), eq(schema.explorePlaces.country, country)),
        );
      const pts = homeRows.filter((r): r is { lat: number; lng: number } => r.lat != null && r.lng != null);
      if (pts.length === 0) {
        console.log(`[seed-cafes] SKIP ${label}, no positioned corpus rows`);
        cp.skipped += 1;
      } else {
        const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
        const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;

        // everything inside the radius: café count + dedupe targets in one scan
        const b = radiusBbox(cLat, cLng, radiusKm);
        const near = await db
          .select({
            name: schema.explorePlaces.name,
            osmId: schema.explorePlaces.osmId,
            lat: schema.explorePlaces.lat,
            lng: schema.explorePlaces.lng,
            tags: schema.explorePlaces.tags,
          })
          .from(schema.explorePlaces)
          .where(
            and(
              gte(schema.explorePlaces.lat, b.s),
              lte(schema.explorePlaces.lat, b.n),
              gte(schema.explorePlaces.lng, b.w),
              lte(schema.explorePlaces.lng, b.e),
            ),
          );
        const inRadius = near.filter(
          (r) => r.lat != null && r.lng != null && kmBetween(cLat, cLng, r.lat, r.lng) <= radiusKm,
        );
        const cafesBefore = inRadius.filter((r) => isCafeTags(r.tags)).length;

        if (cafesBefore >= minCafes) {
          cp.skipped += 1;
          console.log(`[seed-cafes] SKIP ${label}, ${cafesBefore} cafés within ${radiusKm} km (>= ${minCafes})`);
        } else if (dryRun) {
          console.log(`[seed-cafes] DRY ${label}, ${cafesBefore} cafés within ${radiusKm} km, would import`);
          cp.done += 1;
        } else {
          const elements = await postCoverageQuery(buildCafeQuery(cLat, cLng, radiusKm * 1000, cap));
          const existingOsmIds = new Set(
            inRadius.map((r) => r.osmId).filter((v): v is string => v != null),
          );
          const existingNames = new Set(inRadius.map((r) => normName(r.name)));
          const rows = [];
          for (const el of elements) {
            const row = normalizeCoverageElement(el, city, country);
            if (!row) continue;
            const osmId = row.osmId as string;
            if (existingOsmIds.has(osmId)) continue;
            const nameKey = normName(row.name);
            if (existingNames.has(nameKey)) continue;
            existingOsmIds.add(osmId); // dedupe within the batch itself
            existingNames.add(nameKey);
            rows.push(row);
          }
          for (let i = 0; i < rows.length; i += 50) {
            await db.insert(schema.explorePlaces).values(rows.slice(i, i + 50));
          }
          cp.done += 1;
          cp.imported += rows.length;
          console.log(
            `[seed-cafes] OK ${label}, ${cafesBefore} cafés, fetched ${elements.length} → inserted +${rows.length} (now ~${cafesBefore + rows.length})`,
          );
        }
      }
    } catch (e) {
      cp.failed += 1;
      console.error(
        `[seed-cafes] FAIL ${label}, ${e instanceof Error ? e.message : String(e)} (continuing)`,
      );
    }

    cp.idx = idx;
    cp.updatedAt = new Date().toISOString();
    await cacheSet(CHECKPOINT_KEY, cp, 7 * 24 * 60 * 60 * 1000); // checkpoint per city
    await sleep(BETWEEN_CITIES_MS); // polite pacing between cities
  }

  console.log(
    `[seed-cafes] COMPLETE, imported into ${cp.done} cities, skipped ${cp.skipped} already-covered, ` +
      `failed ${cp.failed}, +${cp.imported} cafés total`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-cafes] fatal", e);
  process.exit(1);
});
