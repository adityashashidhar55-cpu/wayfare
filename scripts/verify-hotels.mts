/**
 * Lodging verification script (r10-hotels).
 * Run: npx tsx scripts/verify-hotels.mts
 *
 *   A) Same-hotel mode: setHotel → lodgingPlan mode 'same'; planDayFromHotel
 *      loops day 1 out of and back into the trip hotel.
 *   B) Per-day mode: two different night hotels → mode 'perday';
 *      planDayFromHotel on day 1 STARTS at the day-1 hotel and ENDS at the
 *      day-2 hotel (firstStop is the stop nearest the day-1 hotel, totalKm
 *      matches the haversine chain that finishes at the day-2 hotel).
 *      A day without its own hotel falls back to the trip hotel (loop).
 *   C) Voyager gate: wanderer → UPGRADE_REQUIRED on the lodging mutations;
 *      lodgingPlan stays member-readable.
 *
 * Cleans up the trip and restores the subscription tier.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";

const db = getDb();

const [user] = await db.select().from(schema.users).limit(1);
if (!user) throw new Error("No users in DB to impersonate");
console.log(`Acting as user #${user.id} (${user.name ?? user.email ?? "?"})`);

// ── preserve + set voyager tier (restored in finally) ──────────────────────
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

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${name}${detail ? `, ${detail}` : ""}`);
  if (!cond) failures++;
}

// ── anchors (real coordinates) ─────────────────────────────────────────────
const PARK_HYATT = { name: "Park Hyatt Kyoto", lat: 34.9993, lng: 135.7807 };
const KYOTO_STN_HOTEL = { name: "Hotel Granvia Kyoto (station)", lat: 34.9858, lng: 135.7588 };
const OSAKA_BAY_HOTEL = { name: "Osaka Bay Tower Hotel", lat: 34.6292, lng: 135.1908 };
const KYOTO_TOWER = { name: "Kyoto Tower", lat: 34.9875, lng: 135.7593 }; // ~0.2 km from stn hotel
const NISHINOMIYA = { name: "Nishinomiya Gardens", lat: 34.7429, lng: 135.3562 }; // toward Osaka
const GION = { name: "Gion Corner", lat: 35.0037, lng: 135.7753 }; // near Park Hyatt

const tripIds: number[] = [];
try {
  console.log("\n═══ A) Same-hotel mode ═══");
  const trip = await caller.trips.create({
    title: "hotels-verify",
    destination: "Kyoto, Japan",
    startDate: iso(plusDays(30)),
    endDate: iso(plusDays(32)),
    homeCurrency: "USD",
  });
  tripIds.push(trip.id);
  const { days } = await caller.trips.get({ id: trip.id });
  const [day1, day2, day3] = [...days].sort((a, b) => a.position - b.position);
  if (!day1 || !day2 || !day3) throw new Error("expected 3 trip days");

  let plan = await caller.trips.lodgingPlan({ tripId: trip.id });
  check("no lodging → mode 'none'", plan.mode === "none", `mode=${plan.mode}`);

  await caller.trips.setHotel({
    tripId: trip.id,
    name: PARK_HYATT.name,
    address: "360 Kodaiji Masuyacho, Higashiyama-ku, Kyoto",
    lat: PARK_HYATT.lat,
    lng: PARK_HYATT.lng,
    source: "manual",
  });
  plan = await caller.trips.lodgingPlan({ tripId: trip.id });
  check("trip hotel set → mode 'same'", plan.mode === "same", `mode=${plan.mode}`);
  check("tripHotel echoed", plan.tripHotel?.name === PARK_HYATT.name);
  check("no day hotels", plan.dayHotels.length === 0);

  // day 1: two stops - one next to the hotel, one 30 km away (unambiguous
  // nearest-first under both OSRM driving and the haversine fallback)
  await caller.trips.addStop({ tripId: trip.id, dayId: day1.id, name: NISHINOMIYA.name, category: "activity", lat: NISHINOMIYA.lat, lng: NISHINOMIYA.lng });
  await caller.trips.addStop({ tripId: trip.id, dayId: day1.id, name: GION.name, category: "activity", lat: GION.lat, lng: GION.lng });
  const resA = await caller.trips.planDayFromHotel({ tripId: trip.id, dayId: day1.id });
  console.log(`  plan A: ${JSON.stringify(resA)}`);
  check("same-mode starts at the trip hotel", resA.startHotelName === PARK_HYATT.name, resA.startHotelName);
  check("same-mode loops back to the trip hotel", resA.endHotelName === PARK_HYATT.name, resA.endHotelName);
  check("nearest stop first", resA.firstStop === GION.name, resA.firstStop);
  const expectedLoopKm =
    haversineKm(PARK_HYATT.lat, PARK_HYATT.lng, GION.lat, GION.lng) +
    haversineKm(GION.lat, GION.lng, NISHINOMIYA.lat, NISHINOMIYA.lng) +
    haversineKm(NISHINOMIYA.lat, NISHINOMIYA.lng, PARK_HYATT.lat, PARK_HYATT.lng);
  check(
    "totalKm = hotel→…→hotel loop",
    Math.abs(resA.totalKm - Math.round(expectedLoopKm * 10) / 10) < 0.2,
    `got ${resA.totalKm}, want ~${expectedLoopKm.toFixed(1)}`,
  );

  console.log("\n═══ B) Per-day mode ═══");
  await caller.trips.setDayHotel({ tripId: trip.id, dayId: day1.id, ...KYOTO_STN_HOTEL, address: "Kyoto Station" });
  await caller.trips.setDayHotel({ tripId: trip.id, dayId: day2.id, ...OSAKA_BAY_HOTEL, address: "Osaka bay" });
  plan = await caller.trips.lodgingPlan({ tripId: trip.id });
  check("two night hotels → mode 'perday'", plan.mode === "perday", `mode=${plan.mode}`);
  check("dayHotels derived", plan.dayHotels.length === 2, JSON.stringify(plan.dayHotels));
  check(
    "dayHotels carry day/date",
    plan.dayHotels[0]?.dayId === day1.id && plan.dayHotels[1]?.dayId === day2.id && !!plan.dayHotels[0]?.date,
  );

  // re-plan day 1: legs must start at the day-1 hotel and end at the day-2 hotel
  await caller.trips.addStop({ tripId: trip.id, dayId: day1.id, name: NISHINOMIYA.name, category: "activity", lat: NISHINOMIYA.lat, lng: NISHINOMIYA.lng });
  // drop the two earlier stops so the chain is unambiguous
  const stopsNow = (await caller.trips.get({ id: trip.id })).stops.filter(s => s.dayId === day1.id);
  for (const s of stopsNow.filter(s => s.name !== NISHINOMIYA.name)) {
    await caller.trips.deleteStop({ id: s.id, tripId: trip.id });
  }
  await caller.trips.addStop({ tripId: trip.id, dayId: day1.id, name: KYOTO_TOWER.name, category: "activity", lat: KYOTO_TOWER.lat, lng: KYOTO_TOWER.lng });

  const resB = await caller.trips.planDayFromHotel({ tripId: trip.id, dayId: day1.id });
  console.log(`  plan B: ${JSON.stringify(resB)}`);
  check("per-day starts at day-1 hotel", resB.startHotelName === KYOTO_STN_HOTEL.name, resB.startHotelName);
  check("per-day ends at day-2 hotel", resB.endHotelName === OSAKA_BAY_HOTEL.name, resB.endHotelName);
  check("first leg leaves from the day-1 hotel area", resB.firstStop === KYOTO_TOWER.name, resB.firstStop);
  const expectedPathKm =
    haversineKm(KYOTO_STN_HOTEL.lat, KYOTO_STN_HOTEL.lng, KYOTO_TOWER.lat, KYOTO_TOWER.lng) +
    haversineKm(KYOTO_TOWER.lat, KYOTO_TOWER.lng, NISHINOMIYA.lat, NISHINOMIYA.lng) +
    haversineKm(NISHINOMIYA.lat, NISHINOMIYA.lng, OSAKA_BAY_HOTEL.lat, OSAKA_BAY_HOTEL.lng);
  check(
    "totalKm ends at the day-2 hotel",
    Math.abs(resB.totalKm - Math.round(expectedPathKm * 10) / 10) < 0.2,
    `got ${resB.totalKm}, want ~${expectedPathKm.toFixed(1)}`,
  );
  check("legsToEnd reported", typeof resB.legsToEnd === "number" && resB.legsToEnd >= 1, `${resB.legsToEnd} min`);

  // day 3 has no own hotel → falls back to the trip hotel (loop)
  await caller.trips.addStop({ tripId: trip.id, dayId: day3.id, name: GION.name, category: "activity", lat: GION.lat, lng: GION.lng });
  const resB3 = await caller.trips.planDayFromHotel({ tripId: trip.id, dayId: day3.id });
  console.log(`  plan B-day3: ${JSON.stringify(resB3)}`);
  check("day without hotel falls back to trip hotel", resB3.startHotelName === PARK_HYATT.name, resB3.startHotelName);
  check("fallback day loops home", resB3.endHotelName === PARK_HYATT.name, resB3.endHotelName);

  // clearDayHotel: per-day → same again once both nights are cleared
  await caller.trips.clearDayHotel({ tripId: trip.id, dayId: day1.id });
  await caller.trips.clearDayHotel({ tripId: trip.id, dayId: day2.id });
  plan = await caller.trips.lodgingPlan({ tripId: trip.id });
  check("cleared nights → mode 'same' again", plan.mode === "same", `mode=${plan.mode}`);

  console.log("\n═══ C) Voyager gate ═══");
  await db.update(schema.subscriptions).set({ tier: "wanderer" }).where(eq(schema.subscriptions.userId, user.id));
  const expectGate = async (name: string, fn: () => Promise<unknown>) => {
    let gated = false;
    try {
      await fn();
    } catch (e: any) {
      gated = String(e?.message ?? e).includes("UPGRADE_REQUIRED");
    }
    check(`wanderer → ${name} gated`, gated);
  };
  await expectGate("setDayHotel", () =>
    caller.trips.setDayHotel({ tripId: trip.id, dayId: day1.id, name: "X", lat: 1, lng: 1 }),
  );
  await expectGate("clearDayHotel", () => caller.trips.clearDayHotel({ tripId: trip.id, dayId: day1.id }));
  await expectGate("planDayFromHotel", () => caller.trips.planDayFromHotel({ tripId: trip.id, dayId: day1.id }));
  const planRead = await caller.trips.lodgingPlan({ tripId: trip.id });
  check("lodgingPlan stays member-readable", planRead.mode === "same", `mode=${planRead.mode}`);
  await db.update(schema.subscriptions).set({ tier: "voyager" }).where(eq(schema.subscriptions.userId, user.id));
} finally {
  for (const id of tripIds) {
    try {
      await caller.trips.remove({ id });
      console.log(`Cleaned up trip #${id}`);
    } catch (e) {
      console.warn(`Cleanup of trip #${id} failed: ${e}`);
    }
  }
  if (createdSub) {
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, user.id));
    console.log("Temp voyager subscription removed");
  } else if (prevTier && prevTier !== "voyager") {
    await db.update(schema.subscriptions).set({ tier: prevTier }).where(eq(schema.subscriptions.userId, user.id));
    console.log(`Tier restored to ${prevTier}`);
  }
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nAll lodging checks passed.");
process.exit(0);
