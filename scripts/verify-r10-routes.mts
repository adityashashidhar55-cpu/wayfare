/**
 * r10-routes verification: resilient geocoding, via waypoints, popular-route
 * tagging, obscure corridors, and the OSRM-failure degrade path.
 * Run: npx tsx scripts/verify-r10-routes.mts
 *
 * Scenarios (all trips created are DELETED again at the end):
 *  (a) "NYC" → "Niagara Falls" · car · 4 days   - alias geocoding + small towns
 *  (b) Kyoto → Tokyo via ["Nara"] · transit · 6 - via waypoint gets ≥ 1 day
 *  (c) Osaka → Tokyo · car · 5 days             - must tag the Golden Route
 *  (d) Thoothukudi → Kanyakumari · car · 4 days - obscure corridor completes
 *  (e) Kyoto → Nagoya with OSRM blocked (fetch mock) - straight-line corridor,
 *      routeEstimated = true, plan still completes
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

const createdTripIds: number[] = [];
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures.push(label);
};

interface PlanOut {
  tripId: number;
  title: string;
  singleCity: boolean;
  cities: { city: string; country: string; days: number; via?: boolean }[];
  transfers: {
    from: string;
    to: string;
    km: number;
    routeTag?: string;
    primaryOption: { kind: string; durationMin: number; estimated: boolean } | null;
  }[];
  popularRoute: { slug: string; name: string; blurb: string } | null;
  routeEstimated: boolean;
  geocodeWarnings: string[];
  viaSkipped: { name: string; reason: string }[];
}

function logPlan(p: PlanOut) {
  console.log(`  trip #${p.tripId} "${p.title}" · singleCity=${p.singleCity} · routeEstimated=${p.routeEstimated}`);
  console.log(`  popularRoute: ${p.popularRoute ? `${p.popularRoute.name} (${p.popularRoute.slug})` : "none"}`);
  for (const w of p.geocodeWarnings) console.log(`  warning: ${w}`);
  for (const v of p.viaSkipped) console.log(`  via skipped: "${v.name}", ${v.reason}`);
  console.log("  cities + allocations:");
  for (const c of p.cities) {
    console.log(`    ${c.city} (${c.country}): ${c.days} day(s)${c.via ? " [must-visit]" : ""}`);
  }
  console.log("  transfers:");
  for (const t of p.transfers) {
    console.log(
      `    ${t.from} → ${t.to}: ${t.km} km` +
        (t.primaryOption
          ? ` · ${t.primaryOption.kind} ${Math.round(t.primaryOption.durationMin)}min${t.primaryOption.estimated ? " (est.)" : ""}`
          : "") +
        (t.routeTag ? ` · [${t.routeTag}]` : ""),
    );
  }
}

async function plan(label: string, input: Parameters<typeof caller.roadtrip.planRoadtrip>[0]): Promise<PlanOut> {
  console.log(`═══ ${label} ═══`);
  const t0 = Date.now();
  const p = (await caller.roadtrip.planRoadtrip(input)) as PlanOut;
  createdTripIds.push(p.tripId);
  console.log(`  planned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  logPlan(p);
  console.log("");
  return p;
}

// ── (a) alias geocoding: NYC → Niagara Falls ─────────────────────────────────
const a = await plan('(a) "NYC" → "Niagara Falls" · car · 4 days', {
  originText: "NYC",
  destText: "Niagara Falls",
  mode: "car",
  days: 4,
  startDate: "2027-04-01",
});
check(a.cities.length >= 2, "(a) plan completed with ≥2 cities (alias endpoints geocoded)");

// ── (b) via waypoint: Kyoto → Tokyo via Nara ─────────────────────────────────
const b = await plan('(b) Kyoto → Tokyo · via ["Nara"] · transit · 6 days', {
  originText: "Kyoto",
  destText: "Tokyo",
  via: ["Nara"],
  mode: "transit",
  days: 6,
  startDate: "2027-05-01",
});
const nara = b.cities.find((c) => c.city.toLowerCase().includes("nara"));
check(!!nara && nara.days >= 1, `(b) Nara present with ≥1 day (got ${nara ? `${nara.days}d` : "missing"})`);
check(b.viaSkipped.length === 0, "(b) no via waypoints skipped");
check(b.transfers.some((t) => t.to.toLowerCase().includes("nara") || t.from.toLowerCase().includes("nara")), "(b) a transfer leg touches Nara");

// ── (c) popular route: Osaka → Tokyo tags the Golden Route ───────────────────
const c = await plan("(c) Osaka → Tokyo · car · 5 days", {
  originText: "Osaka",
  destText: "Tokyo",
  mode: "car",
  days: 5,
  startDate: "2027-06-01",
});
check(c.popularRoute?.slug === "golden-route-japan", `(c) popularRoute = Golden Route (got ${c.popularRoute?.slug ?? "none"})`);
check(c.transfers.some((t) => t.routeTag), "(c) ≥1 transfer leg tagged with the route name");
// …and the persisted transport stops carry the tag in their notes JSON.
const cTrip = await caller.trips.get({ id: c.tripId });
const taggedStops = cTrip.stops.filter((s) => {
  if (s.category !== "transport" || !s.notes) return false;
  try {
    return !!(JSON.parse(s.notes) as { transfer?: { routeTag?: string } }).transfer?.routeTag;
  } catch {
    return false;
  }
});
check(taggedStops.length > 0, `(c) ${taggedStops.length} persisted transport stop(s) carry routeTag in notes`);

// ── (d) obscure corridor: Thoothukudi → Kanyakumari ──────────────────────────
const d = await plan("(d) Thoothukudi → Kanyakumari · car · 4 days", {
  originText: "Thoothukudi",
  destText: "Kanyakumari",
  mode: "car",
  days: 4,
  startDate: "2027-07-01",
});
check(d.cities.length >= 2, "(d) obscure corridor completed with ≥2 cities");
check(
  d.cities.every((x) => x.days >= 1),
  "(d) every city has ≥1 day",
);

// ── (e) OSRM failure → straight-line corridor flagged estimated ──────────────
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: unknown) => {
  const u = String(url);
  if (u.includes("router.project-osrm.org")) {
    return new Response(" mocked outage ", { status: 503 });
  }
  return realFetch(url as Parameters<typeof realFetch>[0], init as Parameters<typeof realFetch>[1]);
}) as typeof fetch;
let e: PlanOut | null = null;
try {
  e = await plan("(e) Kyoto → Nagoya · car · 3 days · OSRM mocked down", {
    originText: "Kyoto",
    destText: "Nagoya",
    mode: "car",
    days: 3,
    startDate: "2027-08-01",
  });
} finally {
  globalThis.fetch = realFetch;
}
check(e.routeEstimated === true, "(e) routeEstimated = true under OSRM outage");
check(e.cities.length >= 2, "(e) plan still completed on the straight-line corridor");

// ── cleanup ──────────────────────────────────────────────────────────────────
console.log("═══ cleanup ═══");
for (const id of createdTripIds) {
  await caller.trips.remove({ id });
  console.log(`  deleted trip #${id}`);
}

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
process.exit(0);
