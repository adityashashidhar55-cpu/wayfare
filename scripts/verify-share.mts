/**
 * r12-share verification script.
 * Run: npx tsx scripts/verify-share.mts
 *
 * 1. Owner creates a trip; share.enableShareLink mints a token; getShareState
 *    reflects it; disable → public read fails; re-enable works (idempotent).
 * 2. share.getSharedTrip works WITHOUT auth and is redacted (no member
 *    emails, no trip id, no expenses).
 * 3. Invite an existing user → linked:true; the trip shows in THEIR
 *    trips.list and trips.get works for them.
 * 4. Invite an unknown email → linked:false (pending invite, userId NULL);
 *    after that email signs up + logs in (auth.loginWithPassword), the
 *    pending row is claimed (userId set) and the trip appears in their list.
 * 5. A viewer invitee can read but addStop is FORBIDDEN.
 *
 * Everything created (trip, members, users) is cleaned up at the end.
 */
import { and, eq, inArray } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
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
const PASSWORD = "verify-share-pw-123";
const callerFor = (u?: User) =>
  appRouter.createCaller({ req: new Request("http://verify.local"), resHeaders: new Headers(), user: u });

async function makeUser(email: string, name: string): Promise<User> {
  const unionId = `verify-share-${stamp}-${email}`;
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

const ownerEmail = `owner-${stamp}@verify.local`;
const editorEmail = `editor-${stamp}@verify.local`;
const viewerEmail = `viewer-${stamp}@verify.local`;
const pendingEmail = `pending-${stamp}@verify.local`;

const owner = await makeUser(ownerEmail, "Owner Verify");
const editor = await makeUser(editorEmail, "Editor Verify");
const viewer = await makeUser(viewerEmail, "Viewer Verify");

const ownerCaller = callerFor(owner);
const editorCaller = callerFor(editor);
const viewerCaller = callerFor(viewer);
const anon = callerFor(undefined);

let tripId = 0;
const createdUserIds = [owner.id, editor.id, viewer.id];

try {
  // ── setup: trip + one stop ───────────────────────────────────────────────
  const { id } = await ownerCaller.trips.create({
    title: "Verify Share Trip",
    destination: "Kyoto",
    startDate: "2026-04-04",
    endDate: "2026-04-06",
  });
  tripId = id;
  const full = await ownerCaller.trips.get({ id: tripId });
  const dayId = full.days[0]?.id ?? null;
  await ownerCaller.trips.addStop({ tripId, dayId, name: "Fushimi Inari", category: "activity", startTime: "09:00", durationMin: 120 });
  check("owner creates trip with a stop", full.days.length === 3, `${full.days.length} days`);

  // ── 1. public link lifecycle ─────────────────────────────────────────────
  const st0 = await ownerCaller.share.getShareState({ tripId });
  check("share link starts disabled", st0.enabled === false && st0.token == null);

  const { token } = await ownerCaller.share.enableShareLink({ tripId });
  check("enableShareLink returns a uuid token", /^[0-9a-f-]{36}$/.test(token), token);
  const st1 = await ownerCaller.share.getShareState({ tripId });
  check("getShareState shows enabled", st1.enabled && st1.token === token);

  const again = await ownerCaller.share.enableShareLink({ tripId });
  check("re-enable is idempotent (same token)", again.token === token);

  // ── 2. public read without auth, redacted ────────────────────────────────
  const pub = await anon.share.getSharedTrip({ token });
  check("getSharedTrip works WITHOUT auth", pub.trip.title === "Verify Share Trip" && pub.days.length === 3);
  const pubStop = pub.stops.find((s) => s.name === "Fushimi Inari");
  check("shared stops carry name/category/time/duration", !!pubStop && pubStop.startTime === "09:00" && pubStop.durationMin === 120);
  const asText = JSON.stringify(pub);
  check("payload is redacted (no emails, no trip id, no owner)", !asText.includes("@verify.local") && !asText.includes(String(tripId)) && !("members" in pub));
  check("stop ids present but no internal day tripId leak", pub.stops.every((s) => "id" in s && !("tripId" in s)));

  let anonDenied = false;
  try {
    await anon.share.getShareState({ tripId });
  } catch (e) {
    anonDenied = (e as { code?: string }).code === "UNAUTHORIZED";
  }
  check("getShareState requires auth", anonDenied);

  await ownerCaller.share.disableShareLink({ tripId });
  let gone = false;
  try {
    await anon.share.getSharedTrip({ token });
  } catch (e) {
    gone = (e as { code?: string }).code === "NOT_FOUND";
  }
  check("disabled link stops resolving (NOT_FOUND)", gone);
  await ownerCaller.share.enableShareLink({ tripId });

  // ── 3. invite existing user → linked ─────────────────────────────────────
  const inv1 = await ownerCaller.trips.addMember({ tripId, name: "Editor Verify", email: editorEmail, role: "editor" });
  check("inviting an existing user links immediately", inv1.linked === true);

  const editorList = await editorCaller.trips.list();
  const editorSees = editorList.trips.find((t) => t.id === tripId);
  check("member trip appears in invitee trips.list", !!editorSees && editorSees.ownerId === owner.id);
  const editorGet = await editorCaller.trips.get({ id: tripId });
  check("invitee can open the trip", editorGet.trip.id === tripId && editorGet.members.length >= 2);

  // editors can still edit
  await editorCaller.trips.addStop({ tripId, dayId, name: "Editor-added stop", category: "food" });
  check("editor invitee can addStop", true);

  // ── 4. pending invite → claim on login ───────────────────────────────────
  const inv2 = await ownerCaller.trips.addMember({ tripId, name: "Pending Pal", email: pendingEmail, role: "editor" });
  check("inviting an unknown email stays pending", inv2.linked === false);
  const [pendingRow] = await db
    .select()
    .from(schema.tripMembers)
    .where(and(eq(schema.tripMembers.tripId, tripId), eq(schema.tripMembers.email, pendingEmail)))
    .limit(1);
  check("pending row has userId NULL", !!pendingRow && pendingRow.userId == null);

  // the invitee signs up (row created) and logs in → claim fires
  const pendingUser = await makeUser(pendingEmail, "Pending Pal");
  createdUserIds.push(pendingUser.id);
  await anon.auth.loginWithPassword({ email: pendingEmail, password: PASSWORD });
  const [claimedRow] = await db
    .select()
    .from(schema.tripMembers)
    .where(and(eq(schema.tripMembers.tripId, tripId), eq(schema.tripMembers.email, pendingEmail)))
    .limit(1);
  check("login claims the pending invite (userId set)", claimedRow?.userId === pendingUser.id, `userId=${claimedRow?.userId}`);
  const pendingList = await callerFor(pendingUser).trips.list();
  check("claimed trip shows on the new user's Trips page", pendingList.trips.some((t) => t.id === tripId));

  // ── 5. viewer role: read ok, write blocked ───────────────────────────────
  const inv3 = await ownerCaller.trips.addMember({ tripId, name: "Viewer Verify", email: viewerEmail, role: "viewer" });
  check("viewer invite links with viewer role", inv3.linked === true);
  const [viewerRow] = await db
    .select()
    .from(schema.tripMembers)
    .where(and(eq(schema.tripMembers.tripId, tripId), eq(schema.tripMembers.userId, viewer.id)))
    .limit(1);
  check("member row stores viewer role", viewerRow?.role === "viewer");

  await viewerCaller.trips.get({ id: tripId });
  check("viewer can still read the trip", true);

  let viewerBlocked = false;
  try {
    await viewerCaller.trips.addStop({ tripId, dayId, name: "Viewer stop", category: "activity" });
  } catch (e) {
    viewerBlocked = (e as { code?: string }).code === "FORBIDDEN";
  }
  check("viewer addStop is FORBIDDEN", viewerBlocked);

  let viewerExpenseBlocked = false;
  try {
    await viewerCaller.trips.addExpense({
      tripId,
      title: "Viewer expense",
      amountCents: 500,
      currency: "USD",
      date: "2026-04-04",
      paidById: viewerRow!.id,
    });
  } catch (e) {
    viewerExpenseBlocked = (e as { code?: string }).code === "FORBIDDEN";
  }
  check("viewer addExpense is FORBIDDEN", viewerExpenseBlocked);

  // ── 6. removeMember (owner only) ─────────────────────────────────────────
  await ownerCaller.trips.removeMember({ tripId, memberId: viewerRow!.id });
  const afterRemove = await ownerCaller.trips.get({ id: tripId });
  check("owner can remove a member", !afterRemove.members.some((m) => m.id === viewerRow!.id));

  let editorCantRemove = false;
  try {
    await editorCaller.trips.removeMember({ tripId, memberId: pendingRow!.id });
  } catch (e) {
    editorCantRemove = (e as { code?: string }).code === "FORBIDDEN";
  }
  check("non-owner removeMember is FORBIDDEN", editorCantRemove);
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────────
  if (tripId) {
    try {
      await ownerCaller.trips.remove({ id: tripId });
    } catch {
      await db.delete(schema.tripMembers).where(eq(schema.tripMembers.tripId, tripId));
      await db.delete(schema.trips).where(eq(schema.trips.id, tripId));
    }
  }
  await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll share checks passed ✓");
process.exit(failures ? 1 : 0);
