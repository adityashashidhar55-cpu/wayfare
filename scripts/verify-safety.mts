/**
 * Safety/guidance verification script (r9-safety).
 * Run: npx tsx scripts/verify-safety.mts
 *
 * 1. Probes each official feed for reachability (they may be egress-blocked;
 *    the router must degrade honestly instead of inventing data).
 * 2. Runs travelAdvisory for Japan, Switzerland, and one higher-level country
 *    picked live from the State Dept feed (level ≥ 3 when available).
 * 3. Exercises the tRPC path (caller.safety.travelAdvisory) when a DB user
 *    exists, proving router registration + auth wiring.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import {
  getTravelGuidance,
  parseStateDept,
  parseGdacs,
} from "../api/safety-router";

const FEEDS: { name: string; url: string; kind: "xml" | "json" }[] = [
  { name: "US State Dept (TAsTWs.xml)", url: "https://travel.state.gov/_res/rss/TAsTWs.xml", kind: "xml" },
  { name: "US State Dept (TAs.xml, legacy)", url: "https://travel.state.gov/_res/rss/TAs.xml", kind: "xml" },
  { name: "GDACS RSS", url: "https://www.gdacs.org/xml/rss.xml", kind: "xml" },
  {
    name: "ReliefWeb v2",
    url: "https://api.reliefweb.int/v2/reports?appname=wayfare&limit=1",
    kind: "json",
  },
];

async function probe(feed: (typeof FEEDS)[number]) {
  try {
    const res = await fetch(feed.url, {
      headers: { "user-agent": "wayfare/1.0 (travel guidance)" },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    let detail = "";
    if (feed.kind === "xml" && res.ok) {
      const items = (body.match(/<item>/g) ?? []).length;
      detail = `items=${items}`;
      if (feed.url.includes("TAsTWs")) detail += ` advisoriesParsed=${parseStateDept(body).length}`;
      if (feed.url.includes("gdacs")) detail += ` eventsParsed=${parseGdacs(body).length}`;
    } else {
      detail = body.slice(0, 140).replace(/\s+/g, " ");
    }
    return `${res.ok ? "OK " : "FAIL"} http=${res.status} ${detail}`;
  } catch (e) {
    return `FAIL ${e instanceof Error ? e.message : String(e)}`;
  }
}

console.log("── Feed reachability ──────────────────────────────");
for (const f of FEEDS) {
  console.log(`${f.name.padEnd(36)} ${await probe(f)}`);
}

console.log("\n── travelAdvisory samples ─────────────────────────");

// Pick a higher-level country live from the feed (level ≥ 3 preferred).
let higher = "Ukraine"; // sensible fallback if the feed is blocked
try {
  const res = await fetch(FEEDS[0].url, {
    headers: { "user-agent": "wayfare/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  const parsed = parseStateDept(await res.text());
  const l4 = parsed.find((a) => a.level === 4);
  const l3 = parsed.find((a) => a.level === 3);
  higher = (l4 ?? l3)?.country ?? higher;
  console.log(`(higher-level country picked from live feed: ${higher})`);
} catch {
  console.log(`(feed unreachable, falling back to ${higher})`);
}

const CASES: { label: string; input: { country: string; lat?: number; lng?: number } }[] = [
  { label: "Japan (Tokyo coords)", input: { country: "Japan", lat: 35.68, lng: 139.69 } },
  { label: "Switzerland (Zurich coords)", input: { country: "Switzerland", lat: 47.37, lng: 8.54 } },
  { label: `${higher} (no coords)`, input: { country: higher } },
];

for (const c of CASES) {
  const g = await getTravelGuidance(c.input);
  console.log(`\n▸ ${c.label}`);
  console.log(`  country resolved : ${g.country}`);
  console.log(
    `  advisory         : ${
      g.advisory
        ? `Level ${g.advisory.level}, ${g.advisory.levelLabel} (updated ${g.advisory.updated || "?"})`
        : "null"
    }`,
  );
  console.log(`  overallTone      : ${g.overallTone}`);
  console.log(`  sources          : ${g.sources.join(", ") || "(none)"}`);
  console.log(`  unavailable      : ${g.unavailable.join(", ") || "(none)"}`);
  console.log(`  degraded         : ${g.degraded}`);
  console.log(`  events (${g.events.length}):`);
  for (const e of g.events.slice(0, 3)) {
    console.log(
      `    - [${e.severity}] ${e.kind} · ${e.date}${e.distanceKm != null ? ` · ${e.distanceKm} km` : ""} · ${e.title.slice(0, 90)}`,
    );
  }
  console.log(`  health (${g.health.length}):`);
  for (const h of g.health.slice(0, 3)) {
    console.log(`    - ${h.date} · ${h.source} · ${h.title.slice(0, 90)}`);
  }
}

console.log("\n── tRPC wiring (caller.safety.travelAdvisory) ─────");
const db = getDb();
const [user] = await db.select().from(schema.users).limit(1);
if (!user) {
  console.log("no users in DB, skipped (router still type-checks via appRouter import)");
} else {
  const caller = appRouter.createCaller({
    req: new Request("http://verify.local"),
    resHeaders: new Headers(),
    user,
  });
  const viaTrpc = await caller.safety.travelAdvisory({ country: "Kyoto, Japan", lat: 35.01, lng: 135.76 });
  console.log(
    `Kyoto, Japan via tRPC → level=${viaTrpc.advisory?.level ?? "null"} tone=${viaTrpc.overallTone} degraded=${viaTrpc.degraded} sources=[${viaTrpc.sources.join(", ")}]`,
  );

  // tripAdvisory happy path: first trip the user belongs to.
  const [membership] = await db.select().from(schema.tripMembers).limit(20);
  const memberships = await db
    .select()
    .from(schema.tripMembers)
    .where(eq(schema.tripMembers.userId, user.id))
    .limit(1);
  const m = memberships[0] ?? (membership?.userId === user.id ? membership : undefined);
  if (!m) {
    console.log("user has no trip memberships, tripAdvisory path skipped");
  } else {
    const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, m.tripId)).limit(1);
    const viaTrip = await caller.safety.tripAdvisory({ tripId: m.tripId });
    console.log(
      `tripAdvisory(trip #${m.tripId} "${trip?.destination}") → level=${viaTrip.advisory?.level ?? "null"} ` +
        `label="${viaTrip.advisory?.levelLabel ?? "-"}" tone=${viaTrip.overallTone} ` +
        `events=${viaTrip.events.length} health=${viaTrip.health.length} degraded=${viaTrip.degraded}`,
    );
    if (viaTrip.advisory?.url) console.log(`  url: ${viaTrip.advisory.url}`);
    if (viaTrip.events[0]) console.log(`  first event: ${JSON.stringify(viaTrip.events[0])}`);
  }

  // tripAdvisory guard: a synthetic non-member id must be rejected FORBIDDEN.
  const [anyTrip] = await db.select().from(schema.trips).limit(1);
  const ghostCaller = appRouter.createCaller({
    req: new Request("http://verify.local"),
    resHeaders: new Headers(),
    user: { ...user, id: 999999999 } as typeof user,
  });
  try {
    await ghostCaller.safety.tripAdvisory({ tripId: anyTrip?.id ?? 1 });
    console.log("guard: ghost user → ALLOWED (unexpected!)");
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "UNKNOWN";
    console.log(`guard: ghost user on trip #${anyTrip?.id} → ${code} (expected FORBIDDEN)`);
  }
}
console.log("\ndone");
