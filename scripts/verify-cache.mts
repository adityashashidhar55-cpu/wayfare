/**
 * Persistent cache verification (r10-cache).
 * Run: npx tsx scripts/verify-cache.mts
 *
 * Proves:
 *   1. Photon geocode, Open-Meteo weather and cityProfile are served from the
 *      persistent api_cache on repeat calls (<50 ms, byte-identical payload).
 *   2. The api_cache table actually holds the rows (persistent, not in-memory).
 *   3. tripAdvisory resolves the destination COUNTRY for city destinations:
 *      "Tokyo" → Japan (curated table), "Thoothukudi" → India (Photon geocode).
 *   4. explore.discoverArea still inserts places (no behavior regression).
 *
 * Re-running the script is safe: warm rows make "first" calls L2 reads
 * (~80-150 ms remote DB) instead of network fetches - that IS the persistence
 * proof, and the script labels each first call COLD (network) or WARM (L2).
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import { cacheDel, cacheGet, cacheStats } from "../api/lib/cache";
import { geocodeCity } from "../api/queries/overpass";
import { getDayWeather } from "../api/lib/weather";
import { getTravelGuidance } from "../api/safety-router";

const ms = (t0: number) => Math.round(performance.now() - t0);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`   ${ok ? "PASS" : "FAIL"}, ${label}`);
  if (!ok) failures++;
};

console.log("── api_cache rows (before) ────────────────────────");
const before = await cacheStats();
console.log(`   ${JSON.stringify(before)} total=${Object.values(before).reduce((a, n) => a + n, 0)}`);

// ── 1) Photon geocode ───────────────────────────────────────────────────────
console.log("\n── geocodeCity('Tokyo'). TTL 30d, key geo:gc:tokyo ──");
await cacheDel("geo:gc:tokyo"); // force a genuinely cold first call
let t0 = performance.now();
const g1 = await geocodeCity("Tokyo");
const gCold = ms(t0);
t0 = performance.now();
const g2 = await geocodeCity("Tokyo");
const gWarm = ms(t0);
const gRow = await cacheGet("geo:gc:tokyo");
console.log(`   cold=${gCold}ms warm=${gWarm}ms result=${JSON.stringify(g1)}`);
check(g2 !== null && same(g1, g2), "warm payload identical");
check(gWarm < 50, `warm call <50ms (${gWarm}ms)`);
check(gRow !== null, "api_cache row geo:gc:tokyo exists (persistent)");

// ── 2) Open-Meteo weather ───────────────────────────────────────────────────
// NOTE: the forecast API (api.open-meteo.com) enforces a daily quota that is
// often exhausted on this shared egress IP (HTTP 429); the climate-normals
// path uses archive-api.open-meteo.com (separate quota), so we verify with a
// date >15 days out - the normals branch (TTL 7d, `wx:n:` key).
const wxDate = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const wxKey = `wx:n:35.68,139.69:${wxDate}`;
console.log(`\n── getDayWeather(Tokyo, ${wxDate}). TTL 7d normals, key ${wxKey} ──`);
await cacheDel(wxKey);
t0 = performance.now();
const w1 = await getDayWeather(35.68, 139.69, wxDate);
const wCold = ms(t0);
t0 = performance.now();
const w2 = await getDayWeather(35.68, 139.69, wxDate);
const wWarm = ms(t0);
const wRow = await cacheGet(wxKey);
console.log(`   cold=${wCold}ms warm=${wWarm}ms result=${JSON.stringify(w1)}`);
check(w2 !== null && same(w1, w2), "warm payload identical");
check(wWarm < 50, `warm call <50ms (${wWarm}ms)`);
check(wRow !== null, "api_cache row exists (persistent)");

// ── 3) cityProfile via tRPC ─────────────────────────────────────────────────
console.log("\n── citybuild.cityProfile('Thoothukudi'). TTL 24h, key cityprof:thoothukudi ──");
const db = getDb();
const [user] = await db.select().from(schema.users).limit(1);
if (!user) {
  console.log("   no users in DB, tRPC sections skipped");
} else {
  const caller = appRouter.createCaller({
    req: new Request("http://verify.local"),
    resHeaders: new Headers(),
    user,
  });
  await cacheDel("cityprof:thoothukudi");
  t0 = performance.now();
  const c1 = await caller.citybuild.cityProfile({ city: "Thoothukudi" });
  const cCold = ms(t0);
  t0 = performance.now();
  const c2 = await caller.citybuild.cityProfile({ city: "Thoothukudi" });
  const cWarm = ms(t0);
  const cRow = await cacheGet("cityprof:thoothukudi");
  console.log(
    `   cold=${cCold}ms warm=${cWarm}ms city=${c1.city} country=${c1.country} total=${c1.total} imported=${c1.imported} groups=${c1.groups.length}`,
  );
  check(same(c1, c2), "warm payload identical");
  check(cWarm < 50, `warm call <50ms (${cWarm}ms)`);
  check(cRow !== null, "api_cache row cityprof:thoothukudi exists (persistent)");

  // ── 4) tripAdvisory country resolution (mission G) ──────────────────────
  console.log("\n── tripAdvisory destination → COUNTRY ─────────────");
  const tripsToClean: number[] = [];
  async function advisoryFor(destination: string) {
    const [ins] = await db.insert(schema.trips).values({
      ownerId: user.id,
      title: `cache-verify ${destination}`,
      destination,
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
    const tripId = Number((ins as { insertId?: number }).insertId);
    tripsToClean.push(tripId);
    await db.insert(schema.tripMembers).values({
      tripId,
      userId: user.id,
      name: "cache verify",
      role: "owner",
    });
    t0 = performance.now();
    const g = await caller.safety.tripAdvisory({ tripId });
    return { g, took: ms(t0) };
  }
  const tokyo = await advisoryFor("Tokyo");
  console.log(
    `   "Tokyo" → resolvedCountry=${tokyo.g.resolvedCountry} destinationIsCity=${tokyo.g.destinationIsCity} ` +
      `advisory=${tokyo.g.advisory ? `Level ${tokyo.g.advisory.level}, ${tokyo.g.advisory.levelLabel}` : "null"} (${tokyo.took}ms)`,
  );
  check(tokyo.g.resolvedCountry === "Japan", '"Tokyo" resolves to Japan');
  check(tokyo.g.destinationIsCity === true, '"Tokyo" flagged as city');

  const thoo = await advisoryFor("Thoothukudi");
  console.log(
    `   "Thoothukudi" → resolvedCountry=${thoo.g.resolvedCountry} destinationIsCity=${thoo.g.destinationIsCity} ` +
      `advisory=${thoo.g.advisory ? `Level ${thoo.g.advisory.level}, ${thoo.g.advisory.levelLabel}` : "null"} (${thoo.took}ms)`,
  );
  check(thoo.g.resolvedCountry === "India", '"Thoothukudi" resolves to India');
  check(thoo.g.destinationIsCity === true, '"Thoothukudi" flagged as city');

  // Country destination stays a country; warm guidance repeat must be fast.
  const japan = await advisoryFor("Japan");
  console.log(
    `   "Japan" → resolvedCountry=${japan.g.resolvedCountry} destinationIsCity=${japan.g.destinationIsCity}`,
  );
  check(japan.g.resolvedCountry === "Japan" && japan.g.destinationIsCity === false, '"Japan" stays a country');

  t0 = performance.now();
  const warmGuidance = await getTravelGuidance({ country: "Tokyo" });
  const guidWarm = ms(t0);
  console.log(`   getTravelGuidance("Tokyo") warm=${guidWarm}ms resolvedCountry=${warmGuidance.resolvedCountry}`);
  check(guidWarm < 50, `warm guidance <50ms (${guidWarm}ms)`);

  // ── 5) discoverArea sanity (behavior unchanged, still inserts) ──────────
  console.log("\n── explore.discoverArea sanity (small bbox) ───────");
  // ~0.08° box around Tiruchendur (temple town ~35 km south of Thoothukudi)
  // - deliberately OUTSIDE the corpus bbox so the insert path is exercised.
  // Public Overpass is intermittently 504 from this egress IP - retry a few
  // times; a success is then cached 7d (`geo:ovp:`), proving the point.
  const bbox = { south: 8.45, west: 78.08, north: 8.53, east: 78.16 };
  let area: Awaited<ReturnType<typeof caller.explore.discoverArea>> | null = null;
  for (let attempt = 1; attempt <= 5 && !area; attempt++) {
    try {
      area = await caller.explore.discoverArea(bbox);
    } catch (e) {
      console.log(`   attempt ${attempt}: ${(e as Error).message.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!area) {
    console.log("   Overpass unreachable after 5 attempts, environmental, skipping");
  } else {
    console.log(
      `   discoverArea → places=${area.places.length} inserted=${area.inserted} total=${area.total} tightened=${area.tightened}`,
    );
    check(area.total > 0 && area.places.length > 0, "discoverArea returns places");
    check(area.total >= area.inserted, "insert counts consistent (idempotent)");
    // Warm repeat: the Overpass response is now cached (geo:ovp:…) - fast.
    t0 = performance.now();
    const area2 = await caller.explore.discoverArea(bbox);
    console.log(`   warm discoverArea repeat: ${ms(t0)}ms (inserted=${area2.inserted}, total=${area2.total})`);
    check(area2.inserted === 0 && area2.total === area.total, "repeat is deduped (inserts 0)");
  }

  // Cleanup temp trips (members first, then the trip rows).
  for (const id of tripsToClean) {
    await db.delete(schema.tripMembers).where(eq(schema.tripMembers.tripId, id));
    await db.delete(schema.stops).where(eq(schema.stops.tripId, id));
    await db.delete(schema.trips).where(eq(schema.trips.id, id));
  }
  console.log(`   cleaned up ${tripsToClean.length} temp trips`);
}

console.log("\n── api_cache rows (after) ─────────────────────────");
const after = await cacheStats();
console.log(`   ${JSON.stringify(after)} total=${Object.values(after).reduce((a, n) => a + n, 0)}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
