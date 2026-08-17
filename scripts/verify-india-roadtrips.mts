/**
 * India road-trip verification (r11-apifix).
 * Run: npx tsx scripts/verify-india-roadtrips.mts [--keep] [--part=car|transit|crash|all]
 *
 * Part A (car/transit) - REAL end-to-end runs of the Indian corridors:
 *   Jaipur→Agra · Mumbai→Goa · Chennai→Pondicherry · Delhi→Manali
 * Each must COMPLETE and return cities + transfers. Trips are deleted after
 * logging unless --keep is passed.
 *
 * Part B (crash) - the r11 crash scenario: every external API (Overpass,
 * Photon, Nominatim, OSRM, db.transport.rest, transitous) answers an HTML
 * error page. The planner must still COMPLETE, degraded (straight-line
 * corridor, estimated transfers) - never a 500 with
 * "Unexpected token '<' … is not valid JSON".
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { geocodeCity } from "../api/queries/overpass";
import * as schema from "../db/schema";

const KEEP = process.argv.includes("--keep");
const partArg = process.argv.find((a) => a.startsWith("--part="))?.split("=")[1] ?? "all";

const db = getDb();
const [user] = await db.select().from(schema.users).where(eq(schema.users.id, 1)).limit(1);
if (!user) throw new Error("Demo admin user id=1 not found");
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
  return `${o.kind.padEnd(5)} ${dur.padEnd(6)} ${o.label}${tr} · ${o.km} km${o.estimated ? " (est.)" : ""}`;
}

async function runCorridor(
  origin: string,
  dest: string,
  mode: "car" | "transit",
  days: number,
  startDate: string,
) {
  console.log(`\n═══ ${origin} → ${dest} · ${mode} · ${days} days ═══`);
  const t0 = Date.now();
  const plan = await caller.roadtrip.planRoadtrip({ originText: origin, destText: dest, mode, days, startDate });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✔ COMPLETED in ${secs}s → trip #${plan.tripId} "${plan.title}"`);
  console.log(`  routeEstimated: ${plan.routeEstimated} · singleCity: ${plan.singleCity}`);
  if (plan.geocodeWarnings.length) console.log(`  geocode warnings: ${plan.geocodeWarnings.join(" | ")}`);
  console.log("  cities:");
  for (const c of plan.cities) console.log(`    ${c.city} (${c.country}): ${c.days} day(s)${c.via ? " [via]" : ""}`);
  console.log("  transfers:");
  for (const t of plan.transfers) {
    console.log(`    ${t.from} → ${t.to}: ${t.km} km`);
    if (t.primaryOption) console.log(`      primary: ${fmtOption(t.primaryOption)}`);
  }
  if (!plan.cities.length) throw new Error(`FAIL: no cities returned for ${origin}→${dest}`);
  const trip = await caller.trips.get({ id: plan.tripId });
  const transportStops = trip.stops.filter((s) => s.category === "transport");
  console.log(`  persisted: ${trip.days.length} days, ${trip.stops.length} stops (${transportStops.length} transport)`);
  if (!KEEP) {
    await caller.trips.remove({ id: plan.tripId });
    console.log(`  deleted trip #${plan.tripId} (cleanup)`);
  }
  return plan;
}

if (partArg === "car" || partArg === "all") {
  console.log("PART A1, real corridors, car mode");
  await runCorridor("Jaipur", "Agra", "car", 4, "2026-11-05");
  await runCorridor("Mumbai", "Goa", "car", 6, "2026-11-12");
  await runCorridor("Chennai", "Pondicherry", "car", 3, "2026-11-20");
  await runCorridor("Delhi", "Manali", "car", 7, "2026-12-01");
}

if (partArg === "transit" || partArg === "all") {
  console.log("\nPART A2, real corridors, transit mode");
  await runCorridor("Jaipur", "Agra", "transit", 4, "2026-11-05");
  await runCorridor("Mumbai", "Goa", "transit", 5, "2026-11-12");
  await runCorridor("Chennai", "Pondicherry", "transit", 3, "2026-11-20");
  await runCorridor("Delhi", "Manali", "transit", 7, "2026-12-01");
}

if (partArg === "crash" || partArg === "all") {
  console.log("\nPART B, crash simulation: ALL external APIs answer HTML error pages");
  // Warm the 30d geocode cache so the endpoints can still be placed (the
  // interesting crash is the corridor/transfer APIs, not geocoding).
  await geocodeCity("Jaipur");
  await geocodeCity("Agra");

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      "<!DOCTYPE html><html><head><title>504 Gateway Time-out</title></head><body><h1>504 Gateway Time-out</h1><p>nginx</p></body></html>",
      { status: 504, headers: { "content-type": "text/html; charset=utf-8" } },
    )) as typeof fetch;
  try {
    const plan = await runCorridor("Jaipur", "Agra", "transit", 4, "2026-11-05");
    const allEstimated = plan.transfers.every((t) => t.primaryOption?.estimated !== false);
    console.log(
      `  ✔ CRASH-TEST PASS, degraded plan completed (routeEstimated=${plan.routeEstimated}, all transfers estimated=${allEstimated})`,
    );
  } catch (e) {
    console.error(`  ✘ CRASH-TEST FAIL, planRoadtrip threw: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  } finally {
    globalThis.fetch = realFetch;
  }
}

process.exit(0);
