/**
 * notify.ts (r24-smart) - in-app notification delivery. One table, one
 * helper; the bell polls it. `notifyOnce` keeps interval checks idempotent
 * by refusing a duplicate (same user + kind + tripId + title).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";

export interface NotificationInput {
  // r27: "invite" added. addMember created a pending membership and notified
  // nobody through any channel - no email, and no bell either, so even an
  // invitee who already had an account saw nothing until they happened to
  // open their Trips page.
  kind: "weather" | "travel" | "wishlist" | "tokens" | "reward" | "invite";
  title: string;
  body?: string;
  tripId?: number;
}

/** Create a notification. Never throws - a failed bell must not break the action. */
export async function notify(userId: number, n: NotificationInput): Promise<void> {
  try {
    await getDb().insert(schema.notifications).values({
      userId,
      kind: n.kind,
      title: n.title.slice(0, 255),
      body: n.body ?? null,
      tripId: n.tripId ?? null,
    });
  } catch (e) {
    console.warn("notify: insert failed", e);
  }
}

/** Create unless an identical (kind, tripId, title) notification already exists. */
export async function notifyOnce(userId: number, n: NotificationInput): Promise<boolean> {
  try {
    const db = getDb();
    const [existing] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.kind, n.kind),
          eq(schema.notifications.title, n.title.slice(0, 255)),
          n.tripId != null
            ? eq(schema.notifications.tripId, n.tripId)
            : isNull(schema.notifications.tripId),
        ),
      );
    if (Number(existing?.c ?? 0) > 0) return false;
    await notify(userId, n);
    return true;
  } catch (e) {
    console.warn("notifyOnce: check failed", e);
    return false;
  }
}

/** Latest notifications + unread count for the bell. */
export async function listNotifications(userId: number, limit = 20) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.id))
    .limit(limit);
  const [unread] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return { rows, unread: Number(unread?.c ?? 0) };
}
