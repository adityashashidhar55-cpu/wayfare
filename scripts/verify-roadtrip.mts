/**
 * Road-trip planner verification (r9-roadtrip).
 * Run: npx tsx scripts/verify-roadtrip.mts
 *
 * 1. commuteOptions Kyoto→Osaka (transit) - prints options + which path
 *    produced them (live API vs distance estimate).
 * 2. planRoadtrip Kyoto→Tokyo, transit, 5 days - prints the city list, day
 *    allocation, and per-transfer commute options. This trip is KEPT as the
 *    demo road trip ("Kyoto → Tokyo road trip", owner = demo admin id=1).
 * 3. planRoadtrip Osaka→Hiroshima, car, 4 days - printed, then DELETED.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";

const db = getDb();
const [user] = await db.select().from(schema.users).where(eq(schema.users.id, 1)).limit(1);
if (!user) throw new Error("Demo admin user id=1 not found");
console.log(`Acting as user #${user.id} (${user.name ?? user.email ?? "?"})\n`);

const caller = appRouter.createCaller({
  req: new Request("http://verify.local"),
  resHeaders: new Headers(),
  user,
});

function fmtOption(o: {
  kind: string;
  label: string;
  durationMin: number;
  km: number;
  transfers?: number;
  estimated: boolean;
}) {
  const h = Math.floor(o.durationMin / 60);
  const m = Math.round(o.durationMin % 60);
  const dur = h ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
  const tr = o.transfers ? ` · ${o.transfers} change${o.transfers === 1 ? "" : "s"}` : "";
  return `${o.kind.padEnd(5)} ${dur.padStart(6)} ${o.label}${tr} · ${o.km} km${o.estimated ? " (est.)" : ""}`;
}

function pathTaken(options: { kind: string; estimated: boolean }[]): string {
  const transit = options.filter((o) => o.kind !== "car");
  if (!transit.length) return "car-only";
  return transit.some((o) => !o.estimated)
    ? "LIVE transit API (db.transport.rest / transitous)"
    : "distance-based ESTIMATE fallback (no live coverage)";
}

// ── 1. commuteOptions Kyoto→Osaka ────────────────────────────────────────────
console.log("═══ 1. commuteOptions: Kyoto → Osaka (transit) ═══");
const commute = await caller.roadtrip.commuteOptions({
  fromLat: 34.9858,
  fromLng: 135.7585,
  toLat: 34.7024,
  toLng: 135.4959,
  mode: "transit",
  fromName: "Kyoto",
  toName: "Osaka",
});
for (const o of commute.options) console.log("  " + fmtOption(o));
console.log(`  path taken: ${pathTaken(commute.options)}\n`);

// ── 2. planRoadtrip Kyoto→Tokyo (transit, 5 days) - KEPT as demo ────────────
console.log("═══ 2. planRoadtrip: Kyoto → Tokyo · transit · 5 days (kept as demo) ═══");
const t0 = Date.now();
const demo = await caller.roadtrip.planRoadtrip({
  originText: "Kyoto",
  destText: "Tokyo",
  mode: "transit",
  days: 5,
  startDate: "2026-09-01",
  title: "Kyoto → Tokyo road trip",
});
console.log(`  planned in ${((Date.now() - t0) / 1000).toFixed(1)}s → trip #${demo.tripId} "${demo.title}"`);
console.log(`  singleCity hint: ${demo.singleCity}`);
console.log("  cities + day allocation:");
for (const c of demo.cities) console.log(`    ${c.city} (${c.country}): ${c.days} day(s)`);
console.log("  transfers:");
for (const t of demo.transfers) {
  console.log(`    ${t.from} → ${t.to}: ${t.km} km`);
  if (t.primaryOption) console.log(`      primary: ${fmtOption(t.primaryOption)}`);
}

// Inspect the persisted rows for the demo trip.
const demoTrip = await caller.trips.get({ id: demo.tripId });
const transportStops = demoTrip.stops.filter((s) => s.category === "transport");
console.log(
  `  persisted: ${demoTrip.days.length} days, ${demoTrip.stops.length} stops (${transportStops.length} transport)`,
);
for (const s of transportStops) {
  const day = demoTrip.days.find((d) => d.id === s.dayId);
  let options = 0;
  try {
    options = (JSON.parse(s.notes ?? "") as { transfer: { options: unknown[] } }).transfer.options.length;
  } catch {
    /* ignore */
  }
  console.log(`    day ${day?.date} ${s.startTime} "${s.name}" → ${options} commute option(s) in notes`);
}
console.log("  KEPT in DB as the demo road trip.\n");

// ── 3. planRoadtrip Osaka→Hiroshima (car, 4 days) - deleted ─────────────────
console.log("═══ 3. planRoadtrip: Osaka → Hiroshima · car · 4 days (cleanup after) ═══");
const t1 = Date.now();
const car = await caller.roadtrip.planRoadtrip({
  originText: "Osaka",
  destText: "Hiroshima",
  mode: "car",
  days: 4,
  startDate: "2026-10-01",
});
console.log(`  planned in ${((Date.now() - t1) / 1000).toFixed(1)}s → trip #${car.tripId}`);
for (const c of car.cities) console.log(`    ${c.city}: ${c.days} day(s)`);
for (const t of car.transfers) {
  console.log(
    `    ${t.from} → ${t.to}: ${t.km} km${t.primaryOption ? ` · ${fmtOption(t.primaryOption)}` : ""}`,
  );
}
const carTrip = await caller.trips.get({ id: car.tripId });
console.log(`  persisted: ${carTrip.days.length} days, ${carTrip.stops.length} stops`);
await caller.trips.remove({ id: car.tripId });
console.log(`  deleted trip #${car.tripId} (cleanup)`);

process.exit(0);
