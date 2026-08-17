/**
 * r10-routes edge cases: structured geocode failure (both endpoints),
 * single-endpoint degrade to a single-city plan, unplaceable and
 * over-capacity via waypoints. All created trips are deleted.
 * Run: npx tsx scripts/verify-r10-edge.mts
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";

const db = getDb();
const [user] = await db.select().from(schema.users).where(eq(schema.users.id, 1)).limit(1);
const caller = appRouter.createCaller({ req: new Request("http://verify.local"), resHeaders: new Headers(), user });

// 1. BOTH endpoints garbage → structured GEOCODE_UNKNOWN, no trip created.
try {
  await caller.roadtrip.planRoadtrip({ originText: "Xqzwplm", destText: "Qzvtkjn", mode: "car", days: 3, startDate: "2027-09-01" });
  console.log("1. FAIL, no error thrown");
} catch (e) {
  console.log("1. both-fail error:", (e as Error).message === "GEOCODE_UNKNOWN" ? "GEOCODE_UNKNOWN ✓" : `unexpected: ${(e as Error).message}`);
}

// 2. ONE endpoint garbage → single-city plan around the good one + warning.
const p = await caller.roadtrip.planRoadtrip({ originText: "Kyoto", destText: "Xqzwplm", mode: "car", days: 3, startDate: "2027-09-01" });
console.log("2. one-fail degrade:", JSON.stringify({ singleCity: p.singleCity, cities: p.cities, warnings: p.geocodeWarnings, popularRoute: p.popularRoute }));
await caller.trips.remove({ id: p.tripId });
console.log("   cleaned up trip", p.tripId);

// 3. via with an unplaceable entry → skipped with reason, rest still planned.
const p3 = await caller.roadtrip.planRoadtrip({ originText: "Osaka", destText: "Tokyo", via: ["Xqzwplm", "Nara"], mode: "car", days: 6, startDate: "2027-09-01" });
console.log("3. via partial-fail:", JSON.stringify({ cities: p3.cities.map(c => `${c.city}:${c.days}d${c.via ? "[via]" : ""}`), viaSkipped: p3.viaSkipped, popularRoute: p3.popularRoute?.slug }));
await caller.trips.remove({ id: p3.tripId });
console.log("   cleaned up trip", p3.tripId);

// 4. too many via for the day budget → capped with reason.
const p4 = await caller.roadtrip.planRoadtrip({ originText: "Kyoto", destText: "Tokyo", via: ["Nara", "Nagoya", "Hakone"], mode: "car", days: 3, startDate: "2027-09-01" });
console.log("4. via over-capacity:", JSON.stringify({ cities: p4.cities.map(c => `${c.city}:${c.days}d${c.via ? "[via]" : ""}`), viaSkipped: p4.viaSkipped }));
await caller.trips.remove({ id: p4.tripId });
console.log("   cleaned up trip", p4.tripId);
process.exit(0);
