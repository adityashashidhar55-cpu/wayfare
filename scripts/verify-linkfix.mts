/**
 * r14-linkfix verification script.
 * Run: npx tsx scripts/verify-linkfix.mts
 *
 * 1. Shared trip with finances: a trip with a budget, two expenses and
 *    splits is shared; the PUBLIC getSharedTrip payload carries the redacted
 *    finances (budget, expenses by display name, per-person split summary,
 *    category totals) and a resolved destination - with NO emails, user ids,
 *    member ids or trip id anywhere.
 * 2. Bad token → NOT_FOUND with the friendly "invalid or turned off" message
 *    the /shared/:token page surfaces.
 * 3. Cover: destinationInfo resolves "Bengaluru" → India with coordinates.
 * 4. Referrals: upsertUser mints a referralCode on account creation;
 *    claimReferral attaches referredById once (idempotent, no self-referral,
 *    unknown codes ignored); referralInfo reports the joined count.
 *
 * Everything created (trip, expenses, users) is cleaned up at the end.
 */
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import { upsertUser, findUserByUnionId } from "../api/queries/users";
import { hashPassword } from "../api/lib/passwords";
import type { User } from "../db/schema";

const db = getDb();
let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? `, ${detail}` : ""}`);
  if (!ok) failures++;
}

const stamp = Date.now();
const callerFor = (u?: User) =>
  appRouter.createCaller({ req: new Request("http://verify.local"), resHeaders: new Headers(), user: u });

async function makeUser(email: string, name: string): Promise<User> {
  const unionId = `verify-linkfix-${stamp}-${email}`;
  await upsertUser({
    unionId,
    name,
    email,
    passwordHash: await hashPassword("verify-linkfix-pw"),
    lastSignInAt: new Date(),
  });
  const u = await findUserByUnionId(unionId);
  if (!u) throw new Error(`failed to create ${email}`);
  return u;
}

const owner = await makeUser(`owner-${stamp}@verify.local`, "Owner Verify");
const friend = await makeUser(`friend-${stamp}@verify.local`, "Friend Verify");
const createdUserIds = [owner.id, friend.id];
const ownerCaller = callerFor(owner);
const anon = callerFor(undefined);

let tripId = 0;
try {
  // ── setup: Bengaluru trip with budget + expenses ─────────────────────────
  const { id } = await ownerCaller.trips.create({
    title: "Bengaluru weekend",
    destination: "Bengaluru",
    startDate: "2026-05-01",
    endDate: "2026-05-03",
  });
  tripId = id;
  await db.update(schema.trips).set({ budgetCents: 300000, homeCurrency: "INR" }).where(eq(schema.trips.id, tripId));

  const full = await ownerCaller.trips.get({ id: tripId });
  const ownerMember = full.members.find((m) => m.userId === owner.id)!;
  await ownerCaller.trips.addMember({ tripId, name: "Friend Verify", email: `friend-${stamp}@verify.local`, role: "editor" });
  const withFriend = await ownerCaller.trips.get({ id: tripId });
  const friendMember = withFriend.members.find((m) => m.userId === friend.id)!;

  await ownerCaller.trips.addExpense({
    tripId, title: "Hotel", category: "lodging", amountCents: 200000, currency: "INR",
    date: "2026-05-01", paidById: ownerMember.id, splitMemberIds: [ownerMember.id, friendMember.id],
  });
  await ownerCaller.trips.addExpense({
    tripId, title: "Dosa breakfast", category: "food", amountCents: 36000, currency: "INR",
    date: "2026-05-02", paidById: friendMember.id, splitMemberIds: [ownerMember.id, friendMember.id],
  });

  // ── 1. public payload carries redacted finances ──────────────────────────
  const { token } = await ownerCaller.share.enableShareLink({ tripId });
  const pub = await anon.share.getSharedTrip({ token });

  check("finances present with budget + currency", pub.finances.budgetCents === 300000 && pub.finances.homeCurrency === "INR");
  check("total spent sums both expenses", pub.finances.totalSpentCents === 236000, String(pub.finances.totalSpentCents));
  check("expense list has labels, categories, payer names", pub.finances.expenses.length === 2 &&
    pub.finances.expenses.some((e) => e.label === "Hotel" && e.paidByName === "Owner Verify") &&
    pub.finances.expenses.some((e) => e.label === "Dosa breakfast" && e.paidByName === "Friend Verify"));
  check("category breakdown aggregates", pub.finances.byCategory.some((c) => c.category === "lodging" && c.amountCents === 200000));
  const perPerson = pub.finances.perPerson;
  const ownerShare = perPerson.find((p) => p.name === "Owner Verify");
  const friendShare = perPerson.find((p) => p.name === "Friend Verify");
  check("per-person split summary is correct",
    !!ownerShare && ownerShare.paidCents === 200000 && ownerShare.shareCents === 118000 &&
    !!friendShare && friendShare.paidCents === 36000 && friendShare.shareCents === 118000,
    JSON.stringify(perPerson));

  const asText = JSON.stringify(pub);
  check("payload redacted: no emails, no trip id, no member/user ids",
    !asText.includes("@verify.local") &&
    !/"tripId"|"userId"|"paidById"|"memberId"|"ownerId"|"referredById"/.test(asText) &&
    !asText.includes(`"id":${tripId}`));
  check("still no members array", !("members" in pub));

  // ── 2. bad token → friendly NOT_FOUND ────────────────────────────────────
  let badMsg = "";
  try {
    await anon.share.getSharedTrip({ token: crypto.randomUUID() });
  } catch (e) {
    badMsg = (e as Error).message;
  }
  check("bad token → NOT_FOUND with friendly message",
    badMsg === "This share link is invalid or has been turned off.", badMsg);

  // ── 3. destination-aware cover data ──────────────────────────────────────
  check("destinationInfo resolves Bengaluru → India with coords",
    pub.destinationInfo?.country === "India" && pub.destinationInfo.lat != null,
    JSON.stringify(pub.destinationInfo));

  // ── 4. referrals ─────────────────────────────────────────────────────────
  const ownerFresh = await findUserByUnionId(owner.unionId);
  const friendFresh = await findUserByUnionId(friend.unionId);
  check("upsertUser mints referral codes on creation",
    !!ownerFresh?.referralCode && /^[A-Za-z0-9]{10}$/.test(ownerFresh.referralCode) &&
    !!friendFresh?.referralCode && friendFresh.referralCode !== ownerFresh.referralCode,
    `${ownerFresh?.referralCode} / ${friendFresh?.referralCode}`);

  // referredById starts NULL
  check("referredById starts NULL", ownerFresh?.referredById == null && friendFresh?.referredById == null);

  // friend claims owner's code
  const claim1 = await callerFor(friend).auth.claimReferral({ code: ownerFresh!.referralCode! });
  check("claimReferral attaches the referrer", claim1.claimed === true);
  const friendAfter = await findUserByUnionId(friend.unionId);
  check("referredById persisted", friendAfter?.referredById === owner.id);

  // idempotent: a second claim (even with a different code) does not re-point
  const claim2 = await callerFor(friend).auth.claimReferral({ code: friendFresh!.referralCode! });
  check("self-referral refused", claim2.claimed === false);
  const claim3 = await callerFor(friend).auth.claimReferral({ code: "ZZZZZZZZZZ" });
  check("unknown code refused", claim3.claimed === false);
  const friendFinal = await findUserByUnionId(friend.unionId);
  check("referredById unchanged after repeat claims", friendFinal?.referredById === owner.id);

  // owner's referralInfo counts the join
  const info = await ownerCaller.auth.referralInfo();
  check("referralInfo returns code + joined count", info.code === ownerFresh!.referralCode && info.joined === 1,
    JSON.stringify(info));
  const infoFriend = await callerFor(friend).auth.referralInfo();
  check("friend's own count is zero", infoFriend.joined === 0);

  // anon cannot call referral endpoints
  let anonBlocked = false;
  try {
    await anon.auth.referralInfo();
  } catch (e) {
    anonBlocked = (e as { code?: string }).code === "UNAUTHORIZED";
  }
  check("referralInfo requires auth", anonBlocked);
} finally {
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

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll linkfix checks passed ✓");
process.exit(failures ? 1 : 0);
