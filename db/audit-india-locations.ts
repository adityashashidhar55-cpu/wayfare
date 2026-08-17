/**
 * audit-india-locations.ts (r16-india) - location audit for every
 * explore_places row with country='India'.
 *
 * Flags:
 *   (a) coords missing or outside the India bbox (lat 6–37, lng 68–97)
 *   (b) > 180 km from their city's corpus centroid (centroid = mean of the
 *       city's in-bbox rows; cities are keyed by the raw stored string, e.g.
 *       "Kochi, India" vs "Kochi").
 *
 * For every flagged row, re-geocodes "<name>, <city>, India" via Photon
 * (1 req/s, results filtered to countrycode IN). A confident India match
 * (normalized name containment, same rule as api/queries/place-match.ts
 * lookupOsmPlace) updates the row's coords - and its city when the stored
 * city is clearly wrong (Photon city differs AND new coords sit >100 km
 * from the old city's centroid). Exception: when the verified India
 * location is within 25 km of the stored coords, the stored location was
 * already right - the row is a far-flung getaway under its base city
 * (seed-getaways-cities.ts convention), so it is KEPT unchanged. Flagged
 * rows with no confident India match are wrong-country or hopeless →
 * DELETED.
 *
 * Checkpointed in api_cache ('audit:india:checkpoint') after every row so a
 * sandbox wipe resumes mid-list; --restart ignores it. --dry-run only
 * reports flag counts (no Photon, no writes).
 *
 * Run:    npx tsx db/audit-india-locations.ts [--dry-run] [--restart]
 * Bg:     nohup npx tsx db/audit-india-locations.ts > /tmp/audit-india.log 2>&1 &
 */
import { eq, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet, kmBetween } from "../api/queries/coverage";
import { fetchJson } from "../api/lib/http";
import type { PhotonResponse } from "../api/queries/overpass";

const CHECKPOINT_KEY = "audit:india:checkpoint";
const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; india location audit; +https://wayfare.app)";
const PHOTON_MIN_INTERVAL_MS = 1000; // Photon usage policy: 1 req/s
const DIST_FLAG_KM = 180;
const CITY_FIX_KM = 100; // new coords this far from old-city centroid → stored city was wrong

const INDIA_BBOX = { minLat: 6, maxLat: 37, minLng: 68, maxLng: 97 };
const inIndiaBbox = (lat: number, lng: number) =>
  lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat && lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng;

const DRY_RUN = process.argv.includes("--dry-run");
const RESTART = process.argv.includes("--restart");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Same normalization spirit as place-match.ts normPlace. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface Row {
  id: number;
  name: string;
  city: string;
  lat: number | null;
  lng: number | null;
}

interface PhotonHit {
  lat: number;
  lng: number;
  name: string;
  city: string;
}

interface Checkpoint {
  doneIds: number[]; // flagged ids already processed (fix/delete/skip)
  fixed: number;
  deleted: number;
  kept: number;
  perCity: Record<string, { flagged: number; fixed: number; deleted: number }>;
}

let lastPhotonAt = 0;

/**
 * Geocode "<name>, <city>, India" via Photon; returns the first confident
 * INDIA hit or null. Confident = normalized name containment (both ways,
 * min 3 chars) - the acceptance rule lookupOsmPlace uses.
 */
async function geocodeIndia(name: string, city: string): Promise<PhotonHit | null> {
  const q = `${name}, ${city.replace(/,?\s*india$/i, "")}, India`;
  const wait = PHOTON_MIN_INTERVAL_MS - (Date.now() - lastPhotonAt);
  if (wait > 0) await sleep(wait);
  lastPhotonAt = Date.now();
  try {
    const url = new URL(PHOTON_API);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "5");
    url.searchParams.set("lang", "en");
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 8000,
      userAgent: USER_AGENT,
      service: "photon",
    });
    const n = norm(name);
    for (const f of data.features ?? []) {
      const p = f.properties;
      if ((p.countrycode ?? "").toUpperCase() !== "IN") continue;
      const hitName = (p.name ?? "").trim();
      const hn = norm(hitName);
      if (hn.length < 3 || n.length < 3) continue;
      if (!(hn === n || hn.startsWith(n) || hn.includes(n) || n.includes(hn))) continue;
      const [lng, lat] = f.geometry.coordinates;
      if (typeof lat !== "number" || typeof lng !== "number" || !inIndiaBbox(lat, lng)) continue;
      const hitCity = (p.city ?? p.town ?? p.village ?? p.district ?? p.state ?? "")
        .split(" (")[0]!
        .trim();
      return { lat, lng, name: hitName, city: hitCity };
    }
    return null;
  } catch (e) {
    console.warn(`[audit] photon error for "${q}": ${e instanceof Error ? e.message : e}`);
    await sleep(2000); // backoff; row retried on next run (not marked done)
    return null;
  }
}

/** City label for reports - strip a trailing ", India". */
const cityLabel = (city: string) => city.replace(/,?\s*india$/i, "").trim() || city;

async function main() {
  const db = getDb();
  const rows = (await db
    .select({
      id: schema.explorePlaces.id,
      name: schema.explorePlaces.name,
      city: schema.explorePlaces.city,
      lat: schema.explorePlaces.lat,
      lng: schema.explorePlaces.lng,
    })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.country, "India"))) as Row[];
  console.log(`[audit] ${rows.length} rows with country='India'`);

  // Per-city centroid over in-bbox rows (falls back to all rows when a city
  // has no in-bbox coords at all).
  const byCity = new Map<string, Row[]>();
  for (const r of rows) {
    const g = byCity.get(r.city) ?? [];
    g.push(r);
    byCity.set(r.city, g);
  }
  const centroid = new Map<string, { lat: number; lng: number }>();
  for (const [city, group] of byCity) {
    const inb = group.filter((r) => r.lat != null && r.lng != null && inIndiaBbox(r.lat, r.lng));
    const pool = inb.length > 0 ? inb : group.filter((r) => r.lat != null && r.lng != null);
    if (pool.length === 0) continue;
    centroid.set(city, {
      lat: pool.reduce((s, r) => s + r.lat!, 0) / pool.length,
      lng: pool.reduce((s, r) => s + r.lng!, 0) / pool.length,
    });
  }

  // Flag rows.
  const flagged: { row: Row; reason: string }[] = [];
  for (const r of rows) {
    if (r.lat == null || r.lng == null) {
      flagged.push({ row: r, reason: "no-coords" });
      continue;
    }
    if (!inIndiaBbox(r.lat, r.lng)) {
      flagged.push({ row: r, reason: "outside-india-bbox" });
      continue;
    }
    const c = centroid.get(r.city);
    if (c && kmBetween(c.lat, c.lng, r.lat, r.lng) > DIST_FLAG_KM) {
      flagged.push({ row: r, reason: `>${DIST_FLAG_KM}km-from-centroid` });
    }
  }

  const perCityFlag = new Map<string, number>();
  for (const f of flagged) {
    const label = cityLabel(f.row.city);
    perCityFlag.set(label, (perCityFlag.get(label) ?? 0) + 1);
  }
  console.log(`[audit] flagged ${flagged.length}/${rows.length} rows`);
  for (const [city, n] of [...perCityFlag.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${city}: ${n}`);
  }
  if (DRY_RUN) {
    console.log("[audit] --dry-run: no geocoding, no writes");
    process.exit(0);
  }

  let cp: Checkpoint = { doneIds: [], fixed: 0, deleted: 0, kept: 0, perCity: {} };
  if (!RESTART) {
    cp = (await cacheGet<Checkpoint>(CHECKPOINT_KEY)) ?? cp;
    if (cp.doneIds.length > 0) console.log(`[audit] resuming: ${cp.doneIds.length} flagged rows already processed`);
  }
  const done = new Set(cp.doneIds);
  // Rebuild per-city flagged counts for the final report (cheap, deterministic).
  for (const f of flagged) {
    const label = cityLabel(f.row.city);
    cp.perCity[label] = cp.perCity[label] ?? { flagged: 0, fixed: 0, deleted: 0 };
    cp.perCity[label]!.flagged++;
  }

  const todo = flagged.filter((f) => !done.has(Number(f.row.id)));
  console.log(`[audit] geocoding ${todo.length} flagged rows (1 req/s)…`);
  let processed = 0;
  for (const { row, reason } of todo) {
    const id = Number(row.id);
    const label = cityLabel(row.city);
    const hit = await geocodeIndia(row.name, row.city);
    if (hit) {
      // Verified location ≈ stored location → legit far getaway; keep as-is.
      if (
        row.lat != null &&
        row.lng != null &&
        kmBetween(row.lat, row.lng, hit.lat, hit.lng) <= 25
      ) {
        cp.kept++;
        console.log(`[audit] KEEP "${row.name}" (${row.city}), verified at stored coords (${reason})`);
        done.add(id);
        processed++;
        continue;
      }
      const set: { lat: number; lng: number; city?: string } = { lat: hit.lat, lng: hit.lng };
      const oldC = centroid.get(row.city);
      const cityKey = norm(row.city.replace(/,?\s*india$/i, ""));
      const hitCityKey = norm(hit.city);
      if (
        hit.city &&
        hitCityKey &&
        hitCityKey !== cityKey &&
        !cityKey.includes(hitCityKey) &&
        !hitCityKey.includes(cityKey) &&
        oldC &&
        kmBetween(oldC.lat, oldC.lng, hit.lat, hit.lng) > CITY_FIX_KM
      ) {
        set.city = hit.city;
        console.log(`[audit] city fix: "${row.name}" ${row.city} → ${hit.city}`);
      }
      await db.update(schema.explorePlaces).set(set).where(eq(schema.explorePlaces.id, row.id));
      cp.fixed++;
      cp.perCity[label]!.fixed++;
    } else {
      // No confident India match - wrong-country or hopeless → delete.
      await db.delete(schema.explorePlaces).where(eq(schema.explorePlaces.id, row.id));
      cp.deleted++;
      cp.perCity[label]!.deleted++;
      console.log(`[audit] DELETE "${row.name}" (${row.city}), ${reason}, no India match`);
    }
    done.add(id);
    processed++;
    if (processed % 25 === 0) {
      cp.doneIds = [...done];
      await cacheSet(CHECKPOINT_KEY, cp, TTL_30D);
      console.log(`[audit] ${processed}/${todo.length}, fixed ${cp.fixed}, deleted ${cp.deleted}`);
    }
  }
  cp.doneIds = [...done];
  await cacheSet(CHECKPOINT_KEY, cp, TTL_30D);

  console.log(`\n[audit] done: ${flagged.length} flagged, ${cp.fixed} fixed, ${cp.deleted} deleted, ${cp.kept} kept (verified getaways)`);
  console.log("[audit] per-city (flagged/fixed/deleted):");
  for (const [city, s] of Object.entries(cp.perCity).sort((a, b) => b[1].flagged - a[1].flagged)) {
    console.log(`  ${city}: ${s.flagged}/${s.fixed}/${s.deleted}`);
  }
  const left = await db.execute(
    sql`SELECT COUNT(*) n FROM explore_places WHERE country='India' AND (lat IS NULL OR lng IS NULL OR lat NOT BETWEEN 6 AND 37 OR lng NOT BETWEEN 68 AND 97)`,
  );
  console.log("[audit] rows still outside bbox:", JSON.stringify((left as unknown as unknown[])[0]));
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[audit] FAILED:", e);
    process.exit(1);
  });
}
