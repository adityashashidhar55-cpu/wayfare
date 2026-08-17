/**
 * audit-germany-locations.ts (r16-germany) - location audit for the German
 * explore_places corpus.
 *
 * Corpus reality at authoring time: Germany = Berlin (510) + Munich (466),
 * no 'Deutschland' rows - but the script matches both spellings and
 * normalizes 'Deutschland' → 'Germany' first, so it stays correct if other
 * waves add cities.
 *
 * For every German row:
 *   (a) coords NULL or outside the Germany bbox (lat 47–55.5, lng 5.5–15.5)
 *       → flagged
 *   (b) > 180 km from the city corpus centroid → flagged
 *
 * Flagged rows are re-geocoded "name, city, Germany" through Photon
 * (1 req/s, Germany-filtered). A CONFIDENT match - Photon feature in
 * Germany whose name fuzzy-matches the place AND that is pinned to the
 * right city (city token in the address fields, or ≤ 60 km from the city
 * centroid) - updates lat/lng in place. Anything else is hopeless → DELETE
 * (a place we cannot locate in its own city is worse than no place).
 *
 * Checkpointed in api_cache (`audit:germany:locations`) after every row - 
 * safe against sandbox wipes; re-run resumes. Pass --restart to re-walk.
 * Idempotent: fixed rows pass the checks on the next run, deleted rows are
 * gone.
 *
 * Run:  npx tsx db/audit-germany-locations.ts [--restart] [--dry-run]
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet } from "../api/lib/cache";
import { fetchJson } from "../api/lib/http";
import { normalizeNameKey } from "../api/lib/place-quality";
import { kmBetween } from "../api/queries/coverage";

const CHECKPOINT_KEY = "audit:germany:locations";
const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; Germany location audit)";
const THROTTLE_MS = 1000; // 1 req/s - Photon politeness
const CITY_MATCH_KM = 60; // Photon hit within this of the city centroid = city-pinned
const CENTROID_FLAG_KM = 180;

const BBOX = { s: 47, n: 55.5, w: 5.5, e: 15.5 };
const RESTART = process.argv.includes("--restart");
const DRY_RUN = process.argv.includes("--dry-run");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PlaceRow {
  id: number;
  name: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    town?: string;
    village?: string;
    district?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

interface Checkpoint {
  lastId: number;
  flagged: number;
  updated: number;
  deleted: number;
  skippedOk: number;
  perCity: Record<string, { flagged: number; updated: number; deleted: number }>;
  updatedAt: string;
}

const inBbox = (lat: number, lng: number) =>
  lat >= BBOX.s && lat <= BBOX.n && lng >= BBOX.w && lng <= BBOX.e;

/** Re-geocode "name, city, Germany" via Photon; confident = name + city pinned. */
async function regeocode(
  name: string,
  city: string,
  centroid: { lat: number; lng: number },
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(PHOTON_API);
  url.searchParams.set("q", `${name}, ${city}, Germany`);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  const data = await fetchJson<{ features?: PhotonFeature[] }>(url, {
    timeoutMs: 8000,
    userAgent: USER_AGENT,
    service: "photon",
  });
  const nameKey = normalizeNameKey(name);
  const cityKey = normalizeNameKey(city);
  for (const f of data.features ?? []) {
    const p = f.properties;
    if (normalizeNameKey(p.country ?? "") !== "germany") continue;
    const [lng, lat] = f.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number" || !inBbox(lat, lng)) continue;
    const featName = normalizeNameKey(p.name ?? "");
    if (featName.length < 4 || nameKey.length < 4) continue;
    if (!featName.includes(nameKey) && !nameKey.includes(featName)) continue;
    // city pin: a city token in the address fields, or close to the centroid
    const addr = normalizeNameKey(
      [p.city, p.town, p.village, p.district, p.county, p.state].filter(Boolean).join(" "),
    );
    const cityTokens = cityKey.split(" ").filter((t) => t.length >= 4);
    const cityNamed = cityTokens.length > 0 && cityTokens.some((t) => addr.includes(t));
    const cityNear = kmBetween(lat, lng, centroid.lat, centroid.lng) <= CITY_MATCH_KM;
    if (cityNamed || cityNear) return { lat, lng };
  }
  return null;
}

async function main() {
  const db = getDb();

  // Normalize country spelling first (one pass, tiny).
  const norm = await db.execute(
    sql`UPDATE explore_places SET country = 'Germany' WHERE country = 'Deutschland'`,
  );
  const normRows = Number(
    ((Array.isArray(norm) ? norm[0] : norm) as { affectedRows?: number })?.affectedRows ?? 0,
  );
  console.log(`[audit-de] normalized 'Deutschland' → 'Germany' on ${normRows} rows`);

  const rows = (
    await db
      .select({
        id: schema.explorePlaces.id,
        name: schema.explorePlaces.name,
        city: schema.explorePlaces.city,
        country: schema.explorePlaces.country,
        lat: schema.explorePlaces.lat,
        lng: schema.explorePlaces.lng,
      })
      .from(schema.explorePlaces)
      .where(eq(schema.explorePlaces.country, "Germany"))
      .orderBy(asc(schema.explorePlaces.id))
  ).map((r) => ({ ...r, id: Number(r.id) })) as PlaceRow[];
  console.log(`[audit-de] ${rows.length} German corpus rows${DRY_RUN ? " (DRY RUN)" : ""}`);

  // City centroids from rows whose coords sit inside the Germany bbox.
  const byCity = new Map<string, PlaceRow[]>();
  for (const r of rows) {
    const list = byCity.get(r.city) ?? [];
    list.push(r);
    byCity.set(r.city, list);
  }
  const centroids = new Map<string, { lat: number; lng: number }>();
  for (const [city, list] of byCity) {
    const good = list.filter((r) => r.lat != null && r.lng != null && inBbox(r.lat, r.lng));
    if (good.length > 0) {
      centroids.set(city, {
        lat: good.reduce((s, r) => s + r.lat!, 0) / good.length,
        lng: good.reduce((s, r) => s + r.lng!, 0) / good.length,
      });
    }
  }
  console.log(
    `[audit-de] city centroids: ${[...centroids.entries()].map(([c, p]) => `${c}(${p.lat.toFixed(3)},${p.lng.toFixed(3)})`).join(" ")}`,
  );

  let cp: Checkpoint = (!RESTART && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || {
    lastId: 0,
    flagged: 0,
    updated: 0,
    deleted: 0,
    skippedOk: 0,
    perCity: {},
    updatedAt: "",
  };
  if (RESTART) cp = { lastId: 0, flagged: 0, updated: 0, deleted: 0, skippedOk: 0, perCity: {}, updatedAt: "" };
  if (cp.lastId > 0) {
    console.log(
      `[audit-de] resuming after id ${cp.lastId} (flagged ${cp.flagged}, updated ${cp.updated}, deleted ${cp.deleted})`,
    );
  }

  const bump = (city: string, field: "flagged" | "updated" | "deleted") => {
    const entry = (cp.perCity[city] ??= { flagged: 0, updated: 0, deleted: 0 });
    entry[field] += 1;
  };

  let consecutiveErrors = 0;
  for (const row of rows) {
    if (row.id <= cp.lastId) continue;

    const centroid = centroids.get(row.city);
    const hasCoords = row.lat != null && row.lng != null;
    const outsideBbox = !hasCoords || !inBbox(row.lat!, row.lng!);
    const farFromCity =
      hasCoords && centroid != null && kmBetween(row.lat!, row.lng!, centroid.lat, centroid.lng) > CENTROID_FLAG_KM;

    if (!outsideBbox && !farFromCity) {
      cp.skippedOk += 1;
      cp.lastId = row.id;
      continue;
    }

    cp.flagged += 1;
    bump(row.city, "flagged");
    const reason = !hasCoords ? "no coords" : outsideBbox ? "outside Germany bbox" : `>${CENTROID_FLAG_KM}km from ${row.city} centroid`;
    try {
      const started = Date.now();
      const hit = centroid ? await regeocode(row.name, row.city, centroid) : null;
      if (hit) {
        if (!DRY_RUN) {
          await db
            .update(schema.explorePlaces)
            .set({ lat: hit.lat, lng: hit.lng })
            .where(eq(schema.explorePlaces.id, row.id));
        }
        cp.updated += 1;
        bump(row.city, "updated");
        console.log(
          `[audit-de] FIX #${row.id} "${row.name}" (${row.city}) [${reason}] → ${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}`,
        );
      } else {
        if (!DRY_RUN) {
          await db.delete(schema.explorePlaces).where(eq(schema.explorePlaces.id, row.id));
        }
        cp.deleted += 1;
        bump(row.city, "deleted");
        console.log(`[audit-de] DEL #${row.id} "${row.name}" (${row.city}) [${reason}], no confident re-geocode`);
      }
      consecutiveErrors = 0;
      const elapsed = Date.now() - started;
      if (elapsed < THROTTLE_MS) await sleep(THROTTLE_MS - elapsed);
    } catch (e) {
      consecutiveErrors += 1;
      console.warn(
        `[audit-de] error on #${row.id} "${row.name}": ${e instanceof Error ? e.message : e}, left for next run`,
      );
      await sleep(2000);
      if (consecutiveErrors >= 8) {
        console.error("[audit-de] too many consecutive errors, stopping (checkpoint saved)");
        break;
      }
      continue; // do NOT advance lastId past an unprocessed row
    }

    cp.lastId = row.id;
    cp.updatedAt = new Date().toISOString();
    await cacheSet(CHECKPOINT_KEY, cp, TTL_30D);
  }

  cp.updatedAt = new Date().toISOString();
  await cacheSet(CHECKPOINT_KEY, cp, TTL_30D);

  console.log(
    `\n[audit-de] done: ${cp.flagged} flagged, ${cp.updated} re-geocoded, ${cp.deleted} deleted, ${cp.skippedOk} ok`,
  );
  for (const [city, c] of Object.entries(cp.perCity)) {
    console.log(`[audit-de]   ${city}: ${c.flagged} flagged, ${c.updated} fixed, ${c.deleted} deleted`);
  }
  const left = await db.execute(
    sql`SELECT COUNT(*) AS n FROM explore_places WHERE country = 'Germany'`,
  );
  console.log(`[audit-de] German corpus now ${Number(((Array.isArray(left) ? left[0] : left) as unknown as any[])[0].n)} rows`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[audit-de] FAILED:", e);
  process.exit(1);
});
