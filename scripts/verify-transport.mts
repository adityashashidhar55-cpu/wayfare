/**
 * Transport-mode verification script (r8-transport).
 * Run: npx tsx scripts/verify-transport.mts
 *
 * Creates a throwaway trip with 4 geo stops on one day, switches the day
 * through walk → car → transit → train printing per-leg times, then runs
 * optimizeDay under transit and prints the rewritten legs. Cleans up the
 * trip (and the voyager subscription iff this script created it) afterwards.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";

const db = getDb();

const [user] = await db.select().from(schema.users).limit(1);
if (!user) throw new Error("No users in DB to impersonate");
console.log(`Acting as user #${user.id} (${user.name ?? user.email ?? "?"})`);

// optimizeDay is Voyager-gated - ensure tier (restore afterwards if we changed it).
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

const STOPS = [
  { name: "Kiyomizu-dera", lat: 34.9949, lng: 135.785 },
  { name: "Fushimi Inari", lat: 34.9671, lng: 135.7727 },
  { name: "Arashiyama", lat: 35.0094, lng: 135.6668 },
  { name: "Nara Park", lat: 34.6851, lng: 135.843 },
];

function fmtLegs(legs: { fromId: number; toId: number; minutes: number; km: number }[], nameOf: Map<number, string>) {
  return legs
    .map(l => `    ${nameOf.get(l.fromId)} → ${nameOf.get(l.toId)}: ${l.minutes} min · ${l.km} km`)
    .join("\n");
}

let tripId: number | null = null;
try {
  const created = await caller.trips.create({
    title: "transport-verify",
    destination: "Kyoto",
    startDate: "2026-03-01",
    endDate: "2026-03-02",
  });
  tripId = created.id;
  const trip = await caller.trips.get({ id: tripId });
  const dayId = trip.days[0].id;
  const nameOf = new Map<number, string>();
  for (const [i, s] of STOPS.entries()) {
    const { id } = await caller.trips.addStop({
      tripId,
      dayId,
      name: s.name,
      category: "activity",
      lat: s.lat,
      lng: s.lng,
      startTime: `0${9 + i}:00`.slice(-5),
      durationMin: 90,
    });
    nameOf.set(id, s.name);
  }
  console.log(`\nTrip ${tripId} day ${dayId} with ${STOPS.length} stops`);

  for (const mode of ["walk", "car", "transit", "train"] as const) {
    const res = await caller.trips.setDayTransportMode({ tripId, dayId, mode });
    console.log(`\n== mode: ${mode} (persisted: ${res.mode}) ==`);
    console.log(fmtLegs(res.legs, nameOf));
  }

  // Leave the day on transit, then optimize: must complete + rewrite legs.
  await caller.trips.setDayTransportMode({ tripId, dayId, mode: "transit" });
  const before = await caller.trips.get({ id: tripId });
  const beforeOrder = before.stops.filter(s => s.dayId === dayId).map(s => s.name);
  const opt = await caller.trips.optimizeDay({ tripId, dayId });
  console.log(`\n== optimizeDay under transit ==`);
  console.log(`  completed: ${opt.stops.length} stops re-timed, transportMode=${opt.transportMode}`);
  console.log(`  order before: ${beforeOrder.join(" → ")}`);
  console.log(fmtLegs(opt.legs, nameOf));

  // Confirm mode persisted on the day row
  const after = await caller.trips.get({ id: tripId });
  console.log(`\nDay transportMode after optimize: ${after.days.find(d => d.id === dayId)?.transportMode}`);
} finally {
  if (tripId != null) {
    await caller.trips.remove({ id: tripId });
    console.log(`\nCleaned up trip ${tripId}`);
  }
  if (createdSub) {
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, user.id));
    console.log("Removed temp subscription");
  } else if (prevTier && prevTier !== "voyager") {
    await db.update(schema.subscriptions).set({ tier: prevTier }).where(eq(schema.subscriptions.userId, user.id));
    console.log(`Restored tier ${prevTier}`);
  }
}
process.exit(0);
