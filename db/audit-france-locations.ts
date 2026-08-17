/**
 * audit-france-locations.ts (r16-france) - location-quality audit for the
 * France corpus (explore_places WHERE country='France').
 *
 * Two flags, per the mission:
 *   (a) outside the metropolitan-France bounding box
 *       (lat 41…51.5, lng −5.5…10 - deliberately includes Corsica);
 *   (b) more than 180 km from the place's own city corpus centroid
 *       (centroid = mean lat/lng of that city's France rows). 180 km is
 *       generous on purpose: the Paris corpus legitimately carries Loire /
 *       Normandy day-trip getaways ~130 km out, so only genuinely-wrong
 *       coordinates (wrong city / wrong country / digit slips) trip this.
 *
 * Every flagged row is re-geocoded "<name>, <city>, France" through Photon
 * (komoot, keyless, 1 req/s, results restricted to metro-France bbox and
 * required to come back country=France):
 *     confident  → UPDATE lat/lng in place;
 *     hopeless   → DELETE the row (a France place we cannot place in France
 *                  is worse than no row).
 * Confidence = Photon's top hit name fuzzy-matches the place name (same
 * normalization the journal place-detector uses) AND lands inside the
 * metro-France bbox.
 *
 * Resumable: the per-city work list + outcomes checkpoint to api_cache
 * ('audit:france:checkpoint') after every city (sandbox wipes local files,
 * not the DB). Idempotent - re-run re-audits; already-fixed rows no longer
 * flag. --reset ignores the checkpoint.
 *
 * Run:    npx tsx db/audit-france-locations.ts [--reset] [--dry-run]
 * Photon data © OpenStreetMap contributors, ODbL.
 */
import { and, eq, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet } from "../api/lib/cache";
import { fetchJson } from "../api/lib/http";
import { kmBetween } from "../api/queries/coverage";
import { normalizeNameKey } from "../api/lib/place-quality";
import type { PhotonResponse } from "../api/queries/overpass";

const CHECKPOINT_KEY = "audit:france:checkpoint";
const TTL_7D = 7 * 24 * 60 * 60 * 1000;
const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; France location audit)";
const GEOCODE_GAP_MS = 1_000; // 1 req/s - Photon politeness
// Metropolitan France bbox incl. Corsica (per mission).
const BBOX = { s: 41, n: 51.5, w: -5.5, e: 10 };
const CENTROID_KM = 180;

const RESET = process.argv.includes("--reset");
const DRY_RUN = process.argv.includes("--dry-run");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FranceRow {
  id: number;
  name: string;
  city: string;
  lat: number | null;
  lng: number | null;
}
interface CityReport {
  city: string;
  audited: number;
  outsideBbox: number;
  farFromCentroid: number;
  regeocoded: number;
  deleted: number;
}
interface Checkpoint {
  doneCities: string[];
  reports: CityReport[];
  updatedAt: string;
}

const inBbox = (lat: number, lng: number) =>
  lat >= BBOX.s && lat <= BBOX.n && lng >= BBOX.w && lng <= BBOX.e;

/** Fuzzy "is this Photon's place?": normalized containment, ≥4 chars. */
function nameMatches(placeName: string, photonName: string): boolean {
  const a = normalizeNameKey(placeName);
  const b = normalizeNameKey(photonName);
  if (a.length < 4 || b.length < 4) return false;
  return a === b || a.includes(b) || b.includes(a);
}

interface GeocodeHit {
  lat: number;
  lng: number;
  name: string;
}

/** Re-geocode "<name>, <city>, France" via Photon; confident France hit or null. */
async function geocodeFrance(name: string, city: string): Promise<GeocodeHit | null> {
  const url = new URL(PHOTON_API);
  url.searchParams.set("q", `${name}, ${city}, France`);
  url.searchParams.set("limit", "3");
  url.searchParams.set("lang", "en");
  // Restrict to the metro-France bbox (Photon bbox=minLon,minLat,maxLon,maxLat).
  url.searchParams.set("bbox", `${BBOX.w},${BBOX.s},${BBOX.e},${BBOX.n}`);
  const data = await fetchJson<PhotonResponse>(url, {
    service: "photon",
    userAgent: USER_AGENT,
    timeoutMs: 10_000,
  });
  for (const f of data.features ?? []) {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if ((p.country ?? "") !== "France") continue;
    if (!inBbox(lat, lng)) continue;
    const pname = (p.name ?? "").trim();
    if (!pname || !nameMatches(name, pname)) continue;
    return { lat, lng, name: pname };
  }
  return null;
}

async function main() {
  const db = getDb();

  // All France rows, grouped per city (city corpus centroid = mean position).
  const raw = await db.execute(sql`
    SELECT id, name, city, lat, lng FROM explore_places
    WHERE country = 'France' ORDER BY city, id`);
  const all = ((Array.isArray(raw) ? raw[0] : raw) as unknown as FranceRow[]).map((r) => ({
    ...r,
    id: Number(r.id),
  }));
  const byCity = new Map<string, FranceRow[]>();
  for (const r of all) {
    const list = byCity.get(r.city) ?? [];
    list.push(r);
    byCity.set(r.city, list);
  }
  console.log(`[audit-france] ${all.length} France rows across ${byCity.size} cities`);

  let cp = (!RESET && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || null;
  if (!cp) cp = { doneCities: [], reports: [], updatedAt: "" };
  else console.log(`[audit-france] resuming after ${cp.doneCities.length} cities`);

  for (const [city, rows] of byCity) {
    if (cp.doneCities.includes(city)) continue;
    const report: CityReport = {
      city,
      audited: rows.length,
      outsideBbox: 0,
      farFromCentroid: 0,
      regeocoded: 0,
      deleted: 0,
    };

    // City centroid from positioned rows.
    const pts = rows.filter((r) => r.lat != null && r.lng != null);
    const cLat = pts.reduce((s, r) => s + (r.lat as number), 0) / (pts.length || 1);
    const cLng = pts.reduce((s, r) => s + (r.lng as number), 0) / (pts.length || 1);

    // Flag rows failing either test.
    const flagged: { row: FranceRow; reason: string }[] = [];
    for (const r of rows) {
      if (r.lat == null || r.lng == null) {
        flagged.push({ row: r, reason: "no-position" });
        continue;
      }
      if (!inBbox(r.lat, r.lng)) {
        report.outsideBbox++;
        flagged.push({ row: r, reason: "outside-bbox" });
      } else if (kmBetween(cLat, cLng, r.lat, r.lng) > CENTROID_KM) {
        report.farFromCentroid++;
        flagged.push({ row: r, reason: "far-from-centroid" });
      }
    }

    console.log(
      `[audit-france] ${city}: ${rows.length} audited, ${flagged.length} flagged ` +
        `(bbox ${report.outsideBbox}, >${CENTROID_KM}km ${report.farFromCentroid}, ` +
        `no-pos ${flagged.filter((f) => f.reason === "no-position").length})`,
    );

    // Re-geocode each flagged row; confident → update, hopeless → delete.
    for (const { row, reason } of flagged) {
      if (DRY_RUN) {
        console.log(`  DRY flag [${reason}] ${row.name} (${row.lat},${row.lng})`);
        continue;
      }
      try {
        const hit = await geocodeFrance(row.name, city);
        if (hit) {
          await db
            .update(schema.explorePlaces)
            .set({ lat: hit.lat, lng: hit.lng })
            .where(eq(schema.explorePlaces.id, row.id));
          report.regeocoded++;
          console.log(
            `  FIX [${reason}] ${row.name} (${row.lat},${row.lng}) → (${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}) "${hit.name}"`,
          );
        } else {
          await db.delete(schema.explorePlaces).where(eq(schema.explorePlaces.id, row.id));
          report.deleted++;
          console.log(`  DEL [${reason}] ${row.name} (${row.lat},${row.lng}), no confident France geocode`);
        }
      } catch (e) {
        console.warn(`  ERR re-geocoding ${row.name}: ${e instanceof Error ? e.message : e}`);
      }
      await sleep(GEOCODE_GAP_MS);
    }

    cp.doneCities.push(city);
    cp.reports = cp.reports.filter((r) => r.city !== city).concat(report);
    cp.updatedAt = new Date().toISOString();
    await cacheSet(CHECKPOINT_KEY, cp, TTL_7D);
  }

  // ── summary ──
  console.log("\n[audit-france] ===== per-city report =====");
  let tA = 0, tB = 0, tF = 0, tR = 0, tD = 0;
  for (const r of cp.reports.sort((a, b) => b.audited - a.audited)) {
    console.log(
      `  ${r.city.padEnd(14)} audited ${String(r.audited).padStart(4)} | bbox ${r.outsideBbox} | ` +
        `>${CENTROID_KM}km ${r.farFromCentroid} | regeocoded ${r.regeocoded} | deleted ${r.deleted}`,
    );
    tA += r.audited; tB += r.outsideBbox; tF += r.farFromCentroid; tR += r.regeocoded; tD += r.deleted;
  }
  console.log(
    `[audit-france] TOTAL audited ${tA} | outside-bbox ${tB} | >${CENTROID_KM}km ${tF} | regeocoded ${tR} | deleted ${tD}` +
      (DRY_RUN ? " (DRY RUN, no writes)" : ""),
  );
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[audit-france] FAILED:", e);
    process.exit(1);
  });
}
