/**
 * Bookings E2E (r9-bookings). Run: npx tsx scripts/verify-bookings.mts
 *
 * Against the REAL remote DB + real router (appRouter.createCaller) and the
 * real Hono app (app.request for the inbound webhook):
 *  1. bulk import of 5 realistic confirmations + 1 garbage email into a
 *     throwaway trip → reservations rows + calendar stops on the right days;
 *  2. bookings.myInboundEmail → unique token address;
 *  3. POST /api/inbound/:token (JSON, SendGrid/Mailgun shape) → imports into
 *     the token owner's active trip; unknown token → 404;
 *  4. webhook with a flight email for a trip-less user → trip auto-created.
 * All test users/trips are namespaced "r9v-" and removed afterwards.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { inboundTokenForUser } from "../api/bookings-router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import app from "../api/boot";

const db = getDb();
const tag = `r9v-${Date.now().toString(36)}`;
let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

// ── sample emails ────────────────────────────────────────────────────────────
const UA = `Subject: Your United Airlines flight confirmation
From: United Airlines <unitedairlines@united.com>
United Airlines eTicket Itinerary and Receipt
Confirmation code: X7KQP2
Flight UA 875
Departs: San Francisco (SFO) 11:40 AM, Friday, August 7, 2026
Arrives: Osaka Kansai (KIX) 3:05 PM +1 day
Total charged: USD 1,284.00`;

const JR = `Subject: JR-EAST Train Reservation - Booking Confirmed
From: JR East <noreply@jreast.co.jp>
Reservation number: EJ8K2P4
Train: Hikari 507 (Shinkansen)
From: Tokyo Station
To: Kyoto Station
Departure date: August 9, 2026
Departure time: 09:33
Car 7 · Seat 12A (Reserved)
Total: JPY 14,170`;

const AIRBNB = `Subject: Reservation confirmed - You're going to Kyoto!
From: Airbnb <automated@airbnb.com>
You're staying at Machiya Guesthouse Rojiura
Address: 541-2 Gojocho, Shimogyo Ward, Kyoto, Japan
Check-in: August 7, 2026 3:00 PM
Check-out: August 12, 2026 11:00 AM
Confirmation code: HMKX9TQ4WD
Total: $842.50`;

const HERTZ = `Subject: Your Hertz Rental Confirmation
From: Hertz <reservations@hertz.com>
Rental confirmation number: G4928817
Pick-up location: Kyoto Station Hachijo Exit
Pick-up date: August 12, 2026 10:00 AM
Return date: August 14, 2026 6:00 PM
Class: Compact
Total: USD 210.00`;

const GYG = `Subject: Your GetYourGuide booking is confirmed
From: GetYourGuide <noreply@getyourguide.com>
Booking reference: GYG8A2K4Z
Tour: Fushimi Inari Hidden Hiking Tour
Venue: Inari Station, Fushimi Ward, Kyoto
Date: August 10, 2026
Start time: 08:30
Total: EUR 49.00`;

const LATE_TOUR = `Subject: Your Viator booking is confirmed
From: Viator <noreply@viator.com>
Booking reference: VTR99Z1
Tour: Arashiyama Bamboo Grove Walk
Venue: Arashiyama Station, Kyoto
Date: August 20, 2026
Start time: 09:00
Total: USD 35.00`;

const GARBAGE = `Hey! Are we still on for lunch next week? Let me know.. Mom`;

const BOOKINGCOM = `Subject: Your booking at Hotel Gran Ms Kyoto is confirmed
From: Booking.com <noreply@booking.com>
Booking number: 4499211776
Hotel: Hotel Gran Ms Kyoto
Address: 410-3 Shimomaruyacho, Nakagyo Ward, Kyoto, Japan
Check-in: August 8, 2026 15:00
Check-out: August 10, 2026 11:00
Total price: JPY 38,400`;

const B_FLIGHT = `Subject: Your United Airlines flight confirmation
From: United Airlines <unitedairlines@united.com>
United Airlines eTicket Itinerary
Confirmation code: B7QX2M
Flight UA 838
Departs: San Francisco (SFO) 10:30 AM, Tuesday, September 1, 2026
Arrives: Tokyo Narita (NRT) 1:55 PM +1 day
Total charged: USD 980.00`;

// ── helpers ──────────────────────────────────────────────────────────────────
async function makeUser(suffix: string) {
  const r = await db.insert(schema.users).values({
    unionId: `${tag}-${suffix}`,
    name: `${tag}-${suffix}`,
    role: "user",
  });
  const id = Number(r[0].insertId);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return user!;
}

const callerFor = (user: schema.User) =>
  appRouter.createCaller({
    req: new Request("http://verify.local"),
    resHeaders: new Headers(),
    user,
  });

let userA: schema.User | null = null;
let userB: schema.User | null = null;
let tripAId: number | null = null;
let tripBIds: number[] = [];

try {
  userA = await makeUser("a");
  userB = await makeUser("b");
  await db
    .insert(schema.subscriptions)
    .values({ userId: userA.id, tier: "voyager", status: "active" });
  const callerA = callerFor(userA);
  console.log(
    `Users A=#${userA.id} (voyager), B=#${userB.id} (free, no trips)`
  );

  // ── 1. bulk import ─────────────────────────────────────────────────────────
  console.log("\n[1] bulk parseBookingEmails");
  const created = await callerA.trips.create({
    title: `${tag} Kyoto`,
    destination: "Kyoto, Japan",
    startDate: "2026-08-07",
    endDate: "2026-08-12",
  });
  tripAId = created.id;
  const report = await callerA.bookings.parseBookingEmails({
    tripId: tripAId,
    texts: [UA, JR, AIRBNB, HERTZ, GYG, LATE_TOUR, GARBAGE],
  });
  console.log(
    `  imported=${report.imported.length} failed=${report.failed.length}`
  );
  for (const i of report.imported) {
    console.log(
      `   · [${i.kind}] ${i.title} @${i.date} placed=${i.placed} geocoded=${i.geocoded} day=${i.dayDate}${i.nearestDay ? " (nearest)" : ""}`
    );
  }
  for (const f of report.failed)
    console.log(`   · failed #${f.index}: ${f.reason}`);
  assert(report.imported.length === 6, "6 emails imported");
  assert(report.failed.length === 1, "1 garbage email failed cleanly");
  assert(
    report.failed[0]?.index === 6 &&
      /unrecognized/i.test(report.failed[0].reason),
    "garbage is index 6 with an 'unrecognized' reason"
  );
  const kinds = report.imported.map(i => i.kind).sort();
  assert(
    JSON.stringify(kinds) ===
      JSON.stringify([
        "activity",
        "activity",
        "car",
        "flight",
        "lodging",
        "train",
      ]),
    `kinds detected: ${kinds.join(",")}`
  );
  const late = report.imported.find(i => i.title.includes("Arashiyama"));
  assert(
    late?.nearestDay === true && late.dayDate === "2026-08-12",
    "out-of-range tour flagged nearestDay → placed on 2026-08-12"
  );

  const resRows = await db
    .select()
    .from(schema.reservations)
    .where(eq(schema.reservations.tripId, tripAId));
  assert(resRows.length === 6, "6 reservation rows in DB");
  assert(
    resRows.every(r => r.source === "email-import"),
    "all reservations source=email-import"
  );
  const uaRes = resRows.find(r => r.type === "flight");
  assert(
    uaRes?.confirmationCode === "X7KQP2" &&
      uaRes.title.includes("SFO") &&
      uaRes.amountCents === 128400 &&
      uaRes.currency === "USD",
    `flight reservation fields (code/title/amount), got ${JSON.stringify({ code: uaRes?.confirmationCode, title: uaRes?.title, cents: uaRes?.amountCents, cur: uaRes?.currency })}`
  );
  const airRes = resRows.find(r => r.type === "lodging");
  assert(
    airRes?.startDate === "2026-08-07" && airRes.endDate === "2026-08-12",
    "lodging check-in/out dates"
  );

  const dayRows = await db
    .select()
    .from(schema.tripDays)
    .where(eq(schema.tripDays.tripId, tripAId));
  const stopRows = await db
    .select()
    .from(schema.stops)
    .where(eq(schema.stops.tripId, tripAId));
  const dayDate = (id: number | null) =>
    dayRows.find(d => d.id === id)?.date ?? null;
  const catOn = (date: string) =>
    stopRows.filter(s => dayDate(s.dayId) === date).map(s => s.category);
  assert(
    catOn("2026-08-07").includes("lodging"),
    "lodging stop on Aug 7 (check-in day)"
  );
  assert(
    catOn("2026-08-09").includes("transport"),
    "train stop on Aug 9 (JR day)"
  );
  assert(
    catOn("2026-08-10").includes("activity"),
    "activity stop on Aug 10 (tour day)"
  );
  assert(
    catOn("2026-08-12").includes("transport") &&
      catOn("2026-08-12").includes("activity"),
    "car (transport) + out-of-range tour (activity) both on Aug 12"
  );
  const geoCount = stopRows.filter(s => s.lat != null).length;
  console.log(
    `  geocoded stops: ${geoCount}/${stopRows.length} (network-dependent, not asserted)`
  );

  // ── 2. myInboundEmail ──────────────────────────────────────────────────────
  console.log("\n[2] myInboundEmail");
  const inbound = await callerA.bookings.myInboundEmail();
  const expectedToken = inboundTokenForUser(userA.id);
  assert(
    inbound.address === `trip+${expectedToken}@in.wayfare.app`,
    `address embeds token: ${inbound.address}`
  );
  assert(/SendGrid|Mailgun/.test(inbound.note), "activation note present");

  // ── 3. inbound webhook → active trip ───────────────────────────────────────
  console.log("\n[3] POST /api/inbound/:token (active trip)");
  const res3 = await app.request(`/api/inbound/${expectedToken}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: "Booking.com <noreply@booking.com>",
      subject: "Your booking at Hotel Gran Ms Kyoto is confirmed",
      text: BOOKINGCOM,
    }),
  });
  const body3 = (await res3.json()) as Record<string, unknown>;
  console.log(`  status=${res3.status} body=${JSON.stringify(body3)}`);
  assert(res3.status === 200, "webhook 200");
  assert(
    body3.imported === 1 &&
      body3.tripId === tripAId &&
      body3.tripCreated === false,
    "imported into the existing active trip"
  );
  const resRowsAfter = await db
    .select()
    .from(schema.reservations)
    .where(eq(schema.reservations.tripId, tripAId));
  assert(resRowsAfter.length === 7, "7 reservations after webhook import");
  assert(
    resRowsAfter.some(r => r.title.includes("Hotel Gran Ms Kyoto")),
    "Booking.com hotel reservation filed"
  );

  const bad = await app.request(
    "/api/inbound/999999.0000000000000000000000000000dead",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: BOOKINGCOM }),
    }
  );
  assert(bad.status === 404, "bogus token → 404");

  // ── 4. webhook creates a trip when none is active ──────────────────────────
  console.log("\n[4] POST /api/inbound/:token (trip-less user → creates trip)");
  const tokenB = inboundTokenForUser(userB.id);
  const res4 = await app.request(`/api/inbound/${tokenB}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: "United <unitedairlines@united.com>",
      subject: "Your United Airlines flight confirmation",
      text: B_FLIGHT,
    }),
  });
  const body4 = (await res4.json()) as Record<string, unknown>;
  console.log(`  status=${res4.status} body=${JSON.stringify(body4)}`);
  assert(res4.status === 200 && body4.imported === 1, "imported");
  assert(body4.tripCreated === true, "trip auto-created from flight dates");
  const bTrips = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.ownerId, userB.id));
  tripBIds = bTrips.map(t => Number(t.id));
  assert(bTrips.length === 1, "exactly one trip for user B");
  assert(
    bTrips[0]?.destination === "Tokyo" && bTrips[0].startDate === "2026-09-01",
    `trip named from arrival city (NRT→Tokyo): ${bTrips[0]?.title} ${bTrips[0]?.startDate}`
  );
  const bRes = await db
    .select()
    .from(schema.reservations)
    .where(eq(schema.reservations.tripId, bTrips[0]!.id));
  assert(
    bRes.length === 1 && bRes[0]!.type === "flight",
    "flight reservation on the created trip"
  );
} finally {
  // ── cleanup ────────────────────────────────────────────────────────────────
  console.log("\ncleanup");
  if (userA && tripAId != null) {
    await callerFor(userA).trips.remove({ id: tripAId });
    console.log(`  removed trip A ${tripAId}`);
  }
  if (userB) {
    for (const id of tripBIds) {
      await callerFor(userB).trips.remove({ id });
      console.log(`  removed trip B ${id}`);
    }
  }
  for (const u of [userA, userB]) {
    if (!u) continue;
    await db
      .delete(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, u.id));
    await db.delete(schema.users).where(eq(schema.users.id, u.id));
    console.log(`  removed user ${u.id}`);
  }
}
console.log(
  failures ? `\n${failures} ASSERTION(S) FAILED` : "\nALL CHECKS PASSED"
);
process.exit(failures ? 1 : 0);
