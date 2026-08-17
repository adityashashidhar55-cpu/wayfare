/**
 * Family-travel verification (r9-kids).
 * Run: npx tsx scripts/verify-kids.mts
 *
 * A) Kyoto family trip (withChildren, childAges "4,7", pace=packed):
 *    asserts ≤4 stops/day, no stop starts after 18:30, ≥60% of picks are
 *    kid-friendly/partial, each day gets a "Downtime break" stop while
 *    recharge candidates last, museums get 1h, trips.withChildren/childAges
 *    persisted, and no kid-avoid place is picked.
 * B) generateDay on that trip (no flags sent) must honor the SAME rules
 *    by reading the trip row.
 * C) Regression: same trip WITHOUT children, stopsPerDay=7 → 21 unique
 *    picks (r8 behavior unchanged, dense schedule with evening slots).
 *
 * Cleans up created trips and restores the subscription afterwards.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import { kidClass, isKidRecharge } from "../contracts/kids";

const db = getDb();
let failures = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `, ${extra}` : ""}`);
  if (!cond) failures++;
};

const [user] = await db.select().from(schema.users).limit(1);
if (!user) throw new Error("No users in DB to impersonate");
console.log(`Acting as user #${user.id} (${user.name ?? user.email ?? "?"})`);

const [existingSub] = await db
  .select()
  .from(schema.subscriptions)
  .where(eq(schema.subscriptions.userId, user.id))
  .limit(1);
const createdSub = !existingSub;
const prevTier = existingSub?.tier ?? null;
if (createdSub) {
  await db.insert(schema.subscriptions).values({ userId: user.id, tier: "voyager", status: "active" });
} else if (prevTier !== "voyager") {
  await db.update(schema.subscriptions).set({ tier: "voyager" }).where(eq(schema.subscriptions.userId, user.id));
}

const caller = appRouter.createCaller({
  req: new Request("http://verify.local"),
  resHeaders: new Headers(),
  user,
});

const kyotoPlaces = await db
  .select()
  .from(schema.explorePlaces)
  .where(eq(schema.explorePlaces.city, "Kyoto"));
const byName = new Map(kyotoPlaces.map((p) => [p.name.trim().toLowerCase(), p]));

const toMin = (t: string | null) => (t ? parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10) : null);

async function checkFamilyDayRules(tripId: number, label: string) {
  const trip = await caller.trips.get({ id: tripId });
  const dayGroups = trip.days.map((d) => ({
    date: d.date,
    stops: trip.stops.filter((s) => s.dayId === d.id),
  }));
  let totalPicks = 0;
  let kidPicks = 0;
  let avoidPicks = 0;
  let downtimeDays = 0;
  let daysWithStops = 0;
  let museumOver60 = 0;
  for (const g of dayGroups) {
    if (!g.stops.length) continue;
    daysWithStops++;
    ok(g.stops.length <= 4, `${label} ${g.date}: ≤4 stops`, `${g.stops.length} stops`);
    const late = g.stops.filter((s) => (toMin(s.startTime) ?? 0) > 18 * 60 + 30);
    ok(late.length === 0, `${label} ${g.date}: no stop after 18:30`, late.map((s) => `${s.name}@${s.startTime}`).join(", ") || "latest ok");
    const hasDowntime = g.stops.some((s) => (s.notes ?? "").includes("Downtime break for the kids"));
    if (hasDowntime) downtimeDays++;
    for (const s of g.stops) {
      totalPicks++;
      const place = byName.get(s.name.trim().toLowerCase());
      const cls = kidClass(place ?? { name: s.name, category: s.category });
      if (cls === "kid-friendly" || cls === "kid-partial") kidPicks++;
      if (cls === "kid-avoid") avoidPicks++;
      if (place && (place.tags ?? []).includes("museum") && (s.durationMin ?? 0) > 60) museumOver60++;
    }
  }
  ok(avoidPicks === 0, `${label}: zero kid-avoid picks`, `${avoidPicks}`);
  const ratio = totalPicks ? kidPicks / totalPicks : 0;
  ok(ratio >= 0.6, `${label}: ≥60% kid-friendly/partial picks`, `${kidPicks}/${totalPicks} = ${(ratio * 100).toFixed(0)}%`);
  ok(downtimeDays >= 1, `${label}: ≥1 day has a "Downtime break" stop`, `${downtimeDays}/${daysWithStops} days`);
  ok(museumOver60 === 0, `${label}: museum stops ≤60min`, `${museumOver60} over`);
  return { totalPicks, kidPicks, downtimeDays, daysWithStops };
}

const tripIds: number[] = [];
try {
  // ── A) family trip ──────────────────────────────────────────────────────
  console.log("\nA) generateItinerary Kyoto · withChildren · ages 4,7 · packed (cap→4)");
  const fam = await caller.trips.generateItinerary({
    destination: "Kyoto",
    startDate: "2026-05-04",
    endDate: "2026-05-06",
    pace: "packed", // would be 5/day - family cap must hold it to 4
    withChildren: true,
    childAges: "4,7",
  });
  tripIds.push(fam.id);
  console.log(`  trip #${fam.id}: ${fam.stopsCreated} stops over ${fam.days} days`);
  const famTrip = await caller.trips.get({ id: fam.id });
  ok(famTrip.trip.withChildren === true, "A: trips.withChildren persisted");
  ok(famTrip.trip.childAges === "4,7", "A: trips.childAges persisted", famTrip.trip.childAges ?? "null");
  const a = await checkFamilyDayRules(fam.id, "A");
  // "when possible": expect downtime on as many days as the corpus has
  // distinct unused recharge candidates (park/playground/garden/beach…).
  const rechargeCorpus = kyotoPlaces.filter((p) => p.category !== "food" && isKidRecharge(p)).length;
  const expectedDowntime = Math.min(a.daysWithStops, rechargeCorpus);
  ok(
    a.downtimeDays >= expectedDowntime,
    `A: downtime days match recharge availability (corpus has ${rechargeCorpus})`,
    `${a.downtimeDays}/${a.daysWithStops} days, expected ≥${expectedDowntime}`,
  );

  // ── B) generateDay inherits family rules from the trip row ─────────────
  console.log("\nB) generateDay on the same trip (no flags → reads trip.withChildren)");
  const gen = await caller.trips.generateDay({ tripId: fam.id }); // appends a NEW day
  console.log(`  appended day ${gen.date}: ${gen.stopsCreated} stops`);
  const after = await caller.trips.get({ id: fam.id });
  const newDay = after.days.find((d) => d.date === gen.date);
  const newStops = after.stops.filter((s) => s.dayId === newDay?.id);
  ok(newStops.length > 0 && newStops.length <= 4, "B: ≤4 stops", `${newStops.length}`);
  ok(newStops.every((s) => (toMin(s.startTime) ?? 0) <= 18 * 60 + 30), "B: no stop after 18:30");
  const bKid = newStops.filter((s) => {
    const p = byName.get(s.name.trim().toLowerCase());
    const c = kidClass(p ?? { name: s.name, category: s.category });
    return c === "kid-friendly" || c === "kid-partial";
  }).length;
  ok(bKid / Math.max(1, newStops.length) >= 0.6, "B: ≥60% kid picks", `${bKid}/${newStops.length}`);
  ok(!newStops.some((s) => kidClass(byName.get(s.name.trim().toLowerCase()) ?? { name: s.name, category: s.category }) === "kid-avoid"), "B: no kid-avoid pick");

  // ── C) regression: no-children trip, dense 7/day ───────────────────────
  console.log("\nC) regression: no children · stopsPerDay=7 · 3 days → 21 unique picks");
  const reg = await caller.trips.generateItinerary({
    destination: "Kyoto",
    startDate: "2026-06-01",
    endDate: "2026-06-03",
    pace: "balanced",
    stopsPerDay: 7,
  });
  tripIds.push(reg.id);
  const regTrip = await caller.trips.get({ id: reg.id });
  ok(regTrip.trip.withChildren === false, "C: withChildren defaults false");
  ok(reg.stopsCreated === 21, "C: 21 stops created", `${reg.stopsCreated}`);
  const names = new Set(regTrip.stops.map((s) => s.name));
  ok(names.size === regTrip.stops.length, "C: all picks unique", `${names.size}/${regTrip.stops.length}`);
  ok(
    regTrip.stops.some((s) => (toMin(s.startTime) ?? 0) >= 19 * 60),
    "C: evening slots still exist without kids mode",
  );
} finally {
  for (const id of tripIds) {
    await caller.trips.remove({ id }).catch(() => {});
  }
  if (createdSub) {
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, user.id));
  } else if (prevTier && prevTier !== "voyager") {
    await db.update(schema.subscriptions).set({ tier: prevTier }).where(eq(schema.subscriptions.userId, user.id));
  }
  console.log(`\ncleanup done, ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
