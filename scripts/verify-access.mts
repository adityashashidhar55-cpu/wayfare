/**
 * r15-access verification script.
 * Run: npx tsx scripts/verify-access.mts
 *
 *   A) Non-member WITH an account opens the workspace URL of a share-ENABLED
 *      trip → trips.get throws FORBIDDEN whose serialized cause carries the
 *      shareToken (the client redirects to /shared/<token>). The redirect
 *      target resolves anonymously with the shared content - no dead 403.
 *   B) Logged-out visitor opens /shared/:token → share.getSharedTrip renders
 *      with NO auth (public page never fires an authed query).
 *   C) Non-member opens the workspace URL of a trip WITHOUT sharing →
 *      FORBIDDEN with NO cause → the client shows the friendly
 *      "You don't have access" page (TripNoAccess).
 *   D) Claim-on-login: an anonymous friend participant who left their email
 *      at join is linked (friend_participants.userId) when they later log
 *      in - and, because the session was already converted, they are ALSO
 *      inserted as a trip member, so the converted trip shows in trips.list
 *      and trips.get works for them (no 403).
 *
 * Everything created (trips, members, session, participants, users,
 * subscription) is cleaned up at the end.
 */
import { and, eq, inArray } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { safeErrorCause } from "../api/middleware";
import * as schema from "../db/schema";
import { hashPassword } from "../api/lib/passwords";
import type { User } from "../db/schema";

const db = getDb();
let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? `, ${detail}` : ""}`);
  if (!ok) failures++;
}

const stamp = Date.now();
const PASSWORD = "verify-access-pw-123";
const callerFor = (u?: User) =>
  appRouter.createCaller({ req: new Request("http://verify.local"), resHeaders: new Headers(), user: u });

async function makeUser(email: string, name: string): Promise<User> {
  const unionId = `verify-access-${stamp}-${email}`;
  await db.insert(schema.users).values({
    unionId,
    name,
    email,
    passwordHash: await hashPassword(PASSWORD),
    lastSignInAt: new Date(),
  });
  const [u] = await db.select().from(schema.users).where(eq(schema.users.unionId, unionId)).limit(1);
  if (!u) throw new Error(`failed to create ${email}`);
  return u;
}

const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const ownerEmail = `owner-${stamp}@verify-access.local`;
const outsiderEmail = `outsider-${stamp}@verify-access.local`;
const friendEmail = `friend-${stamp}@verify-access.local`;

const owner = await makeUser(ownerEmail, "Owner Access");
const outsider = await makeUser(outsiderEmail, "Outsider Access");
const ownerCaller = callerFor(owner);
const outsiderCaller = callerFor(outsider);
const anon = callerFor(undefined);
const createdUserIds = [owner.id, outsider.id];

let sharedTripId = 0;
let privateTripId = 0;
let friendTripId: number | null = null;
let sessionId: number | null = null;
let friendUserId: number | null = null;

try {
  // ══ A) 403 carries the shareToken → redirect target resolves ═════════════
  console.log("\nA) non-member + share-enabled trip → FORBIDDEN with shareToken cause");
  const created = await ownerCaller.trips.create({
    title: "Verify Access Shared Trip",
    destination: "Kyoto",
    startDate: "2026-04-04",
    endDate: "2026-04-06",
  });
  sharedTripId = created.id;
  const { token } = await ownerCaller.share.enableShareLink({ tripId: sharedTripId });

  let forbidden: { code?: string; cause?: unknown } | null = null;
  try {
    await outsiderCaller.trips.get({ id: sharedTripId });
  } catch (e) {
    forbidden = e as { code?: string; cause?: unknown };
  }
  check("trips.get is still a 403 for the non-member", forbidden?.code === "FORBIDDEN", String(forbidden?.code));
  const wireCause = safeErrorCause(forbidden?.cause) as { shareToken?: string } | undefined;
  check(
    "serialized error cause carries the active shareToken (client redirects to /shared/<token>)",
    wireCause?.shareToken === token,
    JSON.stringify(wireCause),
  );

  // what the redirected /shared/<token> page will render:
  const shared = await anon.share.getSharedTrip({ token: wireCause?.shareToken ?? "" });
  check(
    "redirect target /shared/<token> resolves with the trip content",
    shared.trip.title === "Verify Access Shared Trip" && shared.days.length === 3,
  );

  // disabling the link drops the token from the cause again
  await ownerCaller.share.disableShareLink({ tripId: sharedTripId });
  let forbidden2: { code?: string; cause?: unknown } | null = null;
  try {
    await outsiderCaller.trips.get({ id: sharedTripId });
  } catch (e) {
    forbidden2 = e as { code?: string; cause?: unknown };
  }
  check(
    "disabled share link → 403 WITHOUT a token (no stale redirects)",
    forbidden2?.code === "FORBIDDEN" && safeErrorCause(forbidden2?.cause) === undefined,
  );
  // re-enable mints a FRESH token (disable cleared the old one)
  const { token: token2 } = await ownerCaller.share.enableShareLink({ tripId: sharedTripId });

  // ══ B) logged-out visitor on /shared/:token ══════════════════════════════
  console.log("\nB) anonymous /shared/:token renders (public query, no auth)");
  const pub = await anon.share.getSharedTrip({ token: token2 });
  check(
    "getSharedTrip works with NO session",
    pub.trip.title === "Verify Access Shared Trip" && pub.trip.destination === "Kyoto",
  );
  const pubText = JSON.stringify(pub);
  check(
    "public payload stays redacted (no emails / trip id)",
    !pubText.includes("@verify-access.local") && !pubText.includes(String(sharedTripId)),
  );
  let anonAuthedBlocked = false;
  try {
    await anon.trips.get({ id: sharedTripId });
  } catch (e) {
    anonAuthedBlocked = (e as { code?: string }).code === "UNAUTHORIZED";
  }
  check("anonymous trips.get is UNAUTHORIZED (login redirect, not a crash)", anonAuthedBlocked);

  // ══ C) trip WITHOUT sharing → friendly no-access (no cause) ══════════════
  console.log("\nC) non-member + trip WITHOUT sharing → 403 without cause");
  const priv = await ownerCaller.trips.create({
    title: "Verify Access Private Trip",
    destination: "Osaka",
    startDate: "2026-05-01",
    endDate: "2026-05-03",
  });
  privateTripId = priv.id;
  let forbidden3: { code?: string; cause?: unknown } | null = null;
  try {
    await outsiderCaller.trips.get({ id: privateTripId });
  } catch (e) {
    forbidden3 = e as { code?: string; cause?: unknown };
  }
  check("trips.get is a 403", forbidden3?.code === "FORBIDDEN");
  check(
    "no shareToken in the cause → client shows the friendly no-access page",
    safeErrorCause(forbidden3?.cause) === undefined,
  );

  // ══ D) friend participant claimed on login → converted trip visible ══════
  console.log("\nD) friend guest leaves email → later login claims participation + trip membership");
  // getTier auto-created a free-tier row earlier - bump it to voyager
  await db.update(schema.subscriptions).set({ tier: "voyager", status: "active" }).where(eq(schema.subscriptions.userId, owner.id));
  const session = await ownerCaller.friends.createSession({
    title: "Verify Access Friends Trip",
    deadlineAt: new Date(Date.now() + 3 * 86_400_000),
    minAvailable: 2,
  });
  sessionId = session.session.id;
  const invite = await anon.friends.createInvite({ token: session.ownerToken });

  // guest joins WITHOUT an account, leaving their email for a later claim
  await anon.friends.joinByToken({
    token: invite.token,
    name: "Future Friend",
    homeName: "Jaipur",
    homeLat: 26.9124,
    homeLng: 75.7873,
    email: friendEmail,
  });
  const COMMON = plusDays(10);
  await anon.friends.submitPlan({
    token: invite.token,
    dates: [COMMON],
    styles: [],
    locationPref: "anywhere",
    useGroupDecision: true,
  });
  await anon.friends.submitPlan({
    token: session.ownerToken,
    dates: [COMMON],
    styles: [],
    locationPref: "anywhere",
    useGroupDecision: true,
  });
  const view = await anon.friends.getSessionByToken({ token: invite.token });
  check("session reached the threshold (met)", view.session.status === "met", view.session.status);

  // owner converts BEFORE the friend has an account → no member row for them
  const conv = await anon.friends.convert({
    token: session.ownerToken,
    city: "Jaipur",
    country: "India",
    startDate: COMMON,
    days: 3,
  });
  friendTripId = conv.tripId;
  const preClaimMembers = await db
    .select()
    .from(schema.tripMembers)
    .where(eq(schema.tripMembers.tripId, friendTripId));
  check(
    "converted trip has only the owner as member (guest had no account)",
    preClaimMembers.length === 1 && preClaimMembers[0]?.role === "owner",
    `${preClaimMembers.length} member(s)`,
  );

  // the friend creates an account with that email and logs in → claim fires
  const friend = await makeUser(friendEmail, "Future Friend");
  friendUserId = friend.id;
  createdUserIds.push(friend.id);
  await anon.auth.loginWithPassword({ email: friendEmail, password: PASSWORD });

  const [participation] = await db
    .select()
    .from(schema.friendParticipants)
    .where(and(eq(schema.friendParticipants.sessionId, sessionId), eq(schema.friendParticipants.email, friendEmail)))
    .limit(1);
  check(
    "login claims the friend_participants row (userId set)",
    participation?.userId === friend.id,
    `userId=${participation?.userId}`,
  );
  const [membership] = await db
    .select()
    .from(schema.tripMembers)
    .where(and(eq(schema.tripMembers.tripId, friendTripId), eq(schema.tripMembers.userId, friend.id)))
    .limit(1);
  check(
    "converted trip gained a member row for the claimed friend",
    membership?.role === "editor",
    membership ? `role=${membership.role}` : "none",
  );

  const friendCaller = callerFor(friend);
  const friendList = await friendCaller.trips.list();
  check(
    "converted trip appears in the friend's trips.list",
    friendList.trips.some((t) => t.id === friendTripId),
  );
  const friendGet = await friendCaller.trips.get({ id: friendTripId });
  check(
    "friend can open the converted trip (no 403)",
    friendGet.trip.id === friendTripId && friendGet.members.length === 2,
  );

  // idempotent: a second login must not duplicate the member row
  await anon.auth.loginWithPassword({ email: friendEmail, password: PASSWORD });
  const afterSecond = await db
    .select()
    .from(schema.tripMembers)
    .where(and(eq(schema.tripMembers.tripId, friendTripId), eq(schema.tripMembers.userId, friend.id)));
  check("second login does not duplicate the member row", afterSecond.length === 1);
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────────
  console.log("\nCleanup");
  for (const id of [sharedTripId, privateTripId, friendTripId ?? 0]) {
    if (!id) continue;
    try {
      await ownerCaller.trips.remove({ id });
    } catch {
      await db.delete(schema.tripMembers).where(eq(schema.tripMembers.tripId, id));
      await db.delete(schema.tripDays).where(eq(schema.tripDays.tripId, id));
      await db.delete(schema.trips).where(eq(schema.trips.id, id));
    }
  }
  if (sessionId != null) {
    await db.delete(schema.friendParticipants).where(eq(schema.friendParticipants.sessionId, sessionId));
    await db.delete(schema.friendSessions).where(eq(schema.friendSessions.id, sessionId));
  }
  await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, owner.id));
  await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  console.log("  trips, session, participants, subscription and users removed");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll r15-access checks passed ✓");
process.exit(failures ? 1 : 0);
