/**
 * Weather verification script (r9-weather).
 * Run: npx tsx scripts/verify-weather.mts
 *
 * Creates two throwaway trips - one ~40 days out (beyond the 16-day forecast
 * horizon → climate normals, approximate:true) and one next week (real
 * forecast, approximate:false) - calls weather.tripWeather for each, prints
 * the rows, and cleans up afterwards. Also exercises the destination-geocode
 * path (trip with no geocoded stops).
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";

const db = getDb();

const [user] = await db.select().from(schema.users).limit(1);
if (!user) throw new Error("No users in DB to impersonate");
console.log(`Acting as user #${user.id} (${user.name ?? user.email ?? "?"})`);

// Trip creation is tier-limited - ensure voyager (restore afterwards if changed).
const [existingSub] = await db
  .select()
  .from(schema.subscriptions)
  .where(eq(schema.subscriptions.userId, user.id))
  .limit(1);
const createdSub = !existingSub;
const prevTier = existingSub?.tier ?? null;
if (createdSub) {
  await db.insert(schema.subscriptions).values({ userId: user.id, tier: "voyager", status: "active" });
  console.log("Temp voyager subscription created");
} else if (prevTier !== "voyager") {
  await db.update(schema.subscriptions).set({ tier: "voyager" }).where(eq(schema.subscriptions.userId, user.id));
  console.log(`Temp tier bump ${prevTier} → voyager`);
}

const caller = appRouter.createCaller({
  req: new Request("http://verify.local"),
  resHeaders: new Headers(),
  user,
});

const iso = (addDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  return d.toISOString().slice(0, 10);
};

const fmtRow = (r: any) =>
  `    day ${r.dayId} ${r.date}: avail=${r.available} approx=${r.approximate} ` +
  (r.available ? `${r.tminC}–${r.tmaxC}°C · ${r.precipMm}mm · ${r.label} (${r.icon})` : "-");

let farTripId: number | null = null;
let nearTripId: number | null = null;
try {
  // ── FAR trip (~40 days out) ──
  const far = await caller.trips.create({
    title: "weather-verify-far",
    destination: "Kyoto",
    startDate: iso(40),
    endDate: iso(42),
  });
  farTripId = far.id;
  console.log(`\nFar trip #${farTripId}: ${iso(40)} → ${iso(42)}`);

  // (a) no stops yet → destination geocode path
  const farGeo = await caller.weather.tripWeather({ tripId: farTripId });
  console.log(`  location (no stops): ${JSON.stringify(farGeo.location)}`);
  console.log(`  summary: ${JSON.stringify(farGeo.summary)}`);
  farGeo.rows.forEach(r => console.log(fmtRow(r)));

  // (b) add geocoded stops → centroid path
  const farDays = farGeo.rows.map(r => r.dayId);
  await caller.trips.addStop({ tripId: farTripId, dayId: farDays[0]!, name: "Kiyomizu-dera", category: "activity", lat: 34.9949, lng: 135.785 });
  await caller.trips.addStop({ tripId: farTripId, dayId: farDays[1]!, name: "Fushimi Inari", category: "activity", lat: 34.9671, lng: 135.7727 });
  const farRes = await caller.weather.tripWeather({ tripId: farTripId });
  console.log(`  location (stops centroid): ${JSON.stringify(farRes.location)}`);
  console.log(`  summary: ${JSON.stringify(farRes.summary)}`);
  farRes.rows.forEach(r => console.log(fmtRow(r)));

  const farOk =
    farRes.rows.length === 3 &&
    farRes.rows.every(r => r.available && r.approximate) &&
    farRes.summary.approximateAll === true;
  console.log(farOk ? "  ✓ FAR: all rows available + approximate:true" : "  ✗ FAR ASSERTION FAILED");

  // ── NEAR trip (next week) ──
  const near = await caller.trips.create({
    title: "weather-verify-near",
    destination: "Kyoto",
    startDate: iso(7),
    endDate: iso(9),
  });
  nearTripId = near.id;
  console.log(`\nNear trip #${nearTripId}: ${iso(7)} → ${iso(9)}`);
  const nearDays = (await caller.weather.tripWeather({ tripId: nearTripId })).rows.map(r => r.dayId);
  await caller.trips.addStop({ tripId: nearTripId, dayId: nearDays[0]!, name: "Arashiyama", category: "activity", lat: 35.0094, lng: 135.6668 });
  const nearRes = await caller.weather.tripWeather({ tripId: nearTripId });
  console.log(`  location: ${JSON.stringify(nearRes.location)}`);
  console.log(`  summary: ${JSON.stringify(nearRes.summary)}`);
  nearRes.rows.forEach(r => console.log(fmtRow(r)));

  const nearOk =
    nearRes.rows.length === 3 &&
    nearRes.rows.every(r => r.available && !r.approximate) &&
    nearRes.summary.approximateAll === false &&
    nearRes.summary.hottestC != null &&
    nearRes.summary.coldestC != null;
  console.log(nearOk ? "  ✓ NEAR: all rows available + approximate:false, real forecast" : "  ✗ NEAR ASSERTION FAILED");

  if (!farOk || !nearOk) process.exitCode = 1;
} finally {
  for (const id of [farTripId, nearTripId]) {
    if (id != null) {
      await caller.trips.remove({ id });
      console.log(`\nCleaned up trip #${id}`);
    }
  }
  if (createdSub) {
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, user.id));
    console.log("Removed temp voyager subscription");
  } else if (prevTier && prevTier !== "voyager") {
    await db.update(schema.subscriptions).set({ tier: prevTier }).where(eq(schema.subscriptions.userId, user.id));
    console.log(`Restored tier ${prevTier}`);
  }
}
