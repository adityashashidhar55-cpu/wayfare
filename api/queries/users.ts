import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";
import { mintUniqueReferralCode } from "../lib/referral";

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

/** Case-insensitive email lookup, used by the credentials (password) login. */
export async function findUserByEmail(email: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(1);
  return rows.at(0);
}

/**
 * Attach pending trip invites (trip_members rows with this email but no
 * userId) to the freshly signed-in / signed-up user. Called right after a
 * successful login or registration so invited trips appear immediately.
 */
export async function claimPendingTripInvites(userId: number, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await getDb()
    .update(schema.tripMembers)
    .set({ userId })
    .where(and(eq(schema.tripMembers.email, normalized), isNull(schema.tripMembers.userId)));
}

// Same palette the trip/friends routers assign to members.
const PRESENCE_COLORS = ["#BC5934", "#44604F", "#6E7FA3", "#A86B8C", "#B98A2E", "#6E9A8B"];

/**
 * r15-access: claim-on-login for friend-session participants. A guest who
 * joined a friends-planning session with their email (but no account yet)
 * gets linked on EVERY login, exactly like pending trip invites. For
 * sessions already converted into a trip, the claimed participant is ALSO
 * added as a trip member (editor) - otherwise the converted trip would
 * stay invisible (and trips.get would 403) even though they're linked.
 * Idempotent: existing member rows (any role) are left untouched.
 */
export async function claimPendingFriendParticipations(userId: number, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const db = getDb();
  await db
    .update(schema.friendParticipants)
    .set({ userId })
    .where(
      and(eq(schema.friendParticipants.email, normalized), isNull(schema.friendParticipants.userId)),
    );
  // Converted sessions for ANY of the user's participations (rows linked
  // just now or earlier - e.g. the session converted after they signed up).
  const participations = await db
    .select()
    .from(schema.friendParticipants)
    .where(eq(schema.friendParticipants.userId, userId));
  if (!participations.length) return;
  const sessionIds = [...new Set(participations.map((p) => p.sessionId))];
  const converted = await db
    .select()
    .from(schema.friendSessions)
    .where(
      and(
        inArray(schema.friendSessions.id, sessionIds),
        isNotNull(schema.friendSessions.tripId),
      ),
    );
  for (const session of converted) {
    const tripId = session.tripId;
    if (tripId == null) continue;
    const [existing] = await db
      .select({ id: schema.tripMembers.id })
      .from(schema.tripMembers)
      .where(and(eq(schema.tripMembers.tripId, tripId), eq(schema.tripMembers.userId, userId)))
      .limit(1);
    if (existing) continue;
    const part = participations.find((p) => p.sessionId === session.id)!;
    await db.insert(schema.tripMembers).values({
      tripId,
      userId,
      name: part.name,
      email: part.email ?? normalized,
      role: "editor",
      presenceColor: PRESENCE_COLORS[userId % PRESENCE_COLORS.length],
    });
  }
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  const updateSet: Partial<InsertUser> = {
    lastSignInAt: new Date(),
    ...data,
  };

  // Referral code (r14-linkfix): mint one for brand-new accounts. Existing
  // users keep theirs - updateSet never carries referralCode. When the row
  // may be an insert (no code given), check first so we don't mint a code
  // for a user who already has one.
  if (values.referralCode === undefined && values.unionId) {
    const existing = await findUserByUnionId(values.unionId);
    if (!existing) {
      values.referralCode = await mintUniqueReferralCode();
    }
  }

  // Admin role is granted ONLY via explicit ownership (OWNER_UNION_ID) or the
  // seeded credentials admin (db/seed-admin.ts). Ordinary sign-ups and guest
  // accounts always stay regular users.
  if (
    values.role === undefined &&
    values.unionId &&
    values.unionId === env.ownerUnionId
  ) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  await getDb()
    .insert(schema.users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}
