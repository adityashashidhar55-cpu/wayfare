/**
 * Friends planning verification (r12-friends).
 * Run: npx tsx scripts/verify-friends.mts
 *
 *   A) Voyager owner creates a session (title, +3d deadline, minAvailable=2)
 *      → owner token + invite path returned.
 *   B) Wanderer tier → createSession throws UPGRADE_REQUIRED (pro gate).
 *   C) Owner mints 3 personal invite links; 3 guests join with homes
 *      Jaipur / Delhi / Agra and submit overlapping dates (+prefs, one uses
 *      "let the group decide") → a common date reaches the threshold.
 *   D) getSessionByToken → status flips voting → met, winning date is the
 *      common date, tally correct, and NO tokens/emails/userIds leak in the
 *      participants projection.
 *   E) suggestDestinations → cities near the Jaipur–Delhi–Agra triangle
 *      (cached on second call).
 *   F) convert: guest token → FORBIDDEN; owner token → trip shell exists
 *      with owner member row + trip_days; session flips to converted.
 *
 * Cleans up the trip, participants, session, and restores the user's tier.
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

const ownerCaller = appRouter.createCaller({
  req: new Request("http://verify.local"),
  resHeaders: new Headers(),
  user,
});
const guestCaller = appRouter.createCaller({
  req: new Request("http://verify.local"),
  resHeaders: new Headers(),
});

const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${name}${detail ? `, ${detail}` : ""}`);
  if (!cond) failures++;
}

let sessionId: number | null = null;
let tripId: number | null = null;

try {
  // ── A) voyager owner creates a session ───────────────────────────────────
  console.log("\nA) createSession as voyager owner");
  const created = await ownerCaller.friends.createSession({
    title: "Verify: friends triangle trip",
    deadlineAt: new Date(Date.now() + 3 * 86_400_000),
    minAvailable: 2,
  });
  sessionId = created.session.id;
  check("session created", created.session.status === "voting");
  check("owner token returned", typeof created.ownerToken === "string" && created.ownerToken.length >= 32);
  check("invite path shape", created.invitePath === `/friends/${created.ownerToken}`);

  // ── B) wanderer gate ─────────────────────────────────────────────────────
  console.log("\nB) wanderer tier → UPGRADE_REQUIRED");
  await db.update(schema.subscriptions).set({ tier: "wanderer" }).where(eq(schema.subscriptions.userId, user.id));
  let gated = false;
  try {
    await ownerCaller.friends.createSession({
      title: "should fail",
      deadlineAt: new Date(Date.now() + 86_400_000),
      minAvailable: 2,
    });
  } catch (e) {
    gated = e instanceof Error && e.message.includes("UPGRADE_REQUIRED");
  }
  check("wanderer blocked with UPGRADE_REQUIRED", gated);
  await db.update(schema.subscriptions).set({ tier: "voyager" }).where(eq(schema.subscriptions.userId, user.id));

  // ── C) invites + guest joins + submissions ───────────────────────────────
  console.log("\nC) 3 invite links, guests join (Jaipur/Delhi/Agra), submit overlapping dates");
  const invites = await Promise.all([
    guestCaller.friends.createInvite({ token: created.ownerToken }),
    guestCaller.friends.createInvite({ token: created.ownerToken }),
    guestCaller.friends.createInvite({ token: created.ownerToken }),
  ]);
  check("3 invites minted", invites.every((i) => i.token.length >= 32 && i.path.startsWith("/friends/")));
  check("invite tokens distinct", new Set(invites.map((i) => i.token)).size === 3);

  const guests = [
    { token: invites[0].token, name: "Guest Jaipur", home: { homeName: "Jaipur", homeLat: 26.9124, homeLng: 75.7873 } },
    { token: invites[1].token, name: "Guest Delhi", home: { homeName: "Delhi", homeLat: 28.6139, homeLng: 77.209 } },
    { token: invites[2].token, name: "Guest Agra", home: { homeName: "Agra", homeLat: 27.1767, homeLng: 78.0081 } },
  ];
  for (const g of guests) {
    await guestCaller.friends.joinByToken({ token: g.token, name: g.name, ...g.home });
  }
  const joined = await guestCaller.friends.getSessionByToken({ token: guests[0].token });
  check(
    "homes recorded",
    joined.participants.filter((p) => p.homeName != null).length === 3,
    joined.participants.map((p) => p.homeName).join(","),
  );

  const COMMON = plusDays(10);
  await guestCaller.friends.submitPlan({
    token: guests[0].token,
    dates: [COMMON, plusDays(11)],
    styles: ["historical", "food"],
    locationPref: "near-me",
    useGroupDecision: false,
  });
  await guestCaller.friends.submitPlan({
    token: guests[1].token,
    dates: [COMMON, plusDays(20)],
    styles: ["adventure"],
    locationPref: "anywhere",
    useGroupDecision: false,
  });
  await guestCaller.friends.submitPlan({
    token: guests[2].token,
    dates: [plusDays(20), plusDays(21)], // NOT on the common date
    styles: [],
    locationPref: "anywhere",
    useGroupDecision: true, // let the group decide
  });
  // invalid style rejected
  let badStyle = false;
  try {
    await guestCaller.friends.submitPlan({
      token: guests[0].token,
      dates: [COMMON],
      styles: ["skydiving" as never],
      locationPref: "anywhere",
      useGroupDecision: false,
    });
  } catch {
    badStyle = true;
  }
  check("invalid style rejected", badStyle);

  // ── D) tally + lazy met flip + privacy ───────────────────────────────────
  console.log("\nD) tally, met flip, privacy");
  const view = await guestCaller.friends.getSessionByToken({ token: guests[0].token });
  check("status flipped to met", view.session.status === "met", view.session.status);
  check("winning date is the common date", view.winningDate === COMMON, String(view.winningDate));
  const commonTally = view.tally.find((t) => t.date === COMMON);
  check("tally counts 2 on common date", commonTally?.count === 2, JSON.stringify(commonTally));
  check("me row is full (own token)", view.me.token === guests[0].token);
  const projection = JSON.stringify(view.participants);
  const leaks =
    projection.includes(guests[1].token) ||
    projection.includes(guests[2].token) ||
    /"userId"/.test(projection) ||
    /"email"/.test(projection) ||
    /"token"/.test(projection);
  check("no tokens/emails/userIds in participants projection", !leaks);
  check("who's in is computed", view.participants.filter((p) => p.availableOnWinningDate).length === 2);
  check("isOwner false for guest", view.isOwner === false);
  const ownerView = await guestCaller.friends.getSessionByToken({ token: created.ownerToken });
  check("isOwner true for owner token", ownerView.isOwner === true);

  // ── E) destination suggestions near the triangle ─────────────────────────
  console.log("\nE) suggestDestinations");
  const sug = await guestCaller.friends.suggestDestinations({ token: guests[0].token });
  check("suggestions returned", sug.suggestions.length > 0, `${sug.suggestions.length} cities`);
  check(
    "suggestions are Indian cities near the triangle",
    sug.suggestions.some((s) => s.country === "India" && s.sumKm < 2 * 1000),
    sug.suggestions.slice(0, 3).map((s) => `${s.city}(${s.sumKm}km)`).join(", "),
  );
  check("availableCount = 2 on winning date", sug.suggestions[0]?.availableCount === 2);
  const sug2 = await guestCaller.friends.suggestDestinations({ token: created.ownerToken });
  check("cache reused (identical)", JSON.stringify(sug2.suggestions) === JSON.stringify(sug.suggestions));
  const [sessionRow] = await db.select().from(schema.friendSessions).where(eq(schema.friendSessions.id, sessionId!)).limit(1);
  check("suggestionsJson cached in DB", (sessionRow?.suggestionsJson ?? "").includes(sug.suggestions[0]?.city ?? "~"));

  // ── F) convert ───────────────────────────────────────────────────────────
  console.log("\nF) convert to trip");
  let guestBlocked = false;
  try {
    await guestCaller.friends.convert({
      token: guests[0].token,
      city: sug.suggestions[0]!.city,
      country: sug.suggestions[0]!.country,
      startDate: COMMON,
      days: 4,
    });
  } catch (e) {
    guestBlocked = e instanceof Error && e.message.includes("Only the organizer");
  }
  check("guest token blocked from converting", guestBlocked);

  const conv = await guestCaller.friends.convert({
    token: created.ownerToken,
    city: sug.suggestions[0]!.city,
    country: sug.suggestions[0]!.country,
    startDate: COMMON,
    days: 4,
  });
  tripId = conv.tripId;
  check("trip created", typeof tripId === "number" && tripId > 0);
  const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).limit(1);
  check("trip destination matches pick", trip?.destination === `${sug.suggestions[0]!.city}, ${sug.suggestions[0]!.country}`, trip?.destination);
  check("trip dates = winning date + 4 days", trip?.startDate === COMMON && trip?.endDate === plusDays(13), `${trip?.startDate}→${trip?.endDate}`);
  const members = await db.select().from(schema.tripMembers).where(eq(schema.tripMembers.tripId, tripId));
  check("owner member row exists", members.some((m) => m.role === "owner" && m.userId === user.id));
  const days = await db.select().from(schema.tripDays).where(eq(schema.tripDays.tripId, tripId));
  check("4 trip_days created", days.length === 4, String(days.length));
  const [finalSession] = await db.select().from(schema.friendSessions).where(eq(schema.friendSessions.id, sessionId!)).limit(1);
  check("session converted + tripId set", finalSession?.status === "converted" && finalSession?.tripId === tripId);
  const idem = await guestCaller.friends.convert({
    token: created.ownerToken,
    city: "Elsewhere",
    country: "Nowhere",
    startDate: COMMON,
    days: 3,
  });
  check("double convert is idempotent", idem.tripId === tripId);
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────────
  console.log("\nCleanup");
  if (sessionId != null) {
    await db.delete(schema.friendParticipants).where(eq(schema.friendParticipants.sessionId, sessionId));
    await db.delete(schema.friendSessions).where(eq(schema.friendSessions.id, sessionId));
  }
  if (tripId != null) {
    await db.delete(schema.tripMembers).where(eq(schema.tripMembers.tripId, tripId));
    await db.delete(schema.tripDays).where(eq(schema.tripDays.tripId, tripId));
    await db.delete(schema.trips).where(eq(schema.trips.id, tripId));
  }
  if (createdSub) {
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, user.id));
  } else if (prevTier && prevTier !== "voyager") {
    await db.update(schema.subscriptions).set({ tier: prevTier }).where(eq(schema.subscriptions.userId, user.id));
  }
  console.log("  session, participants, trip and tier restored");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
