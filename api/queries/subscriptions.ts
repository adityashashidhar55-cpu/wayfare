import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import type { TierName } from "@contracts/premium";

/** Fetch the user's subscription row, creating a free-tier row on first access. */
export async function getSubscription(userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .limit(1);
  if (rows[0]) return rows[0];
  await db.insert(schema.subscriptions).values({ userId, tier: "wanderer" });
  const created = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .limit(1);
  return created[0]!;
}

/**
 * The user's EFFECTIVE tier right now.
 *
 * r27: this used to be `status === "active" ? tier : "wanderer"`, which never
 * looked at currentPeriodEnd. The column was written on every checkout and
 * read by nothing, so a Voyager grant lasted forever - a subscription product
 * that only ever charged once.
 *
 * A canceled subscription still returns voyager until the paid period ends:
 * the customer paid through that date and revoking on the cancel click would
 * be taking back time they own.
 */
export async function getTier(userId: number): Promise<TierName> {
  const sub = await getSubscription(userId);
  if (sub.tier !== "voyager") return "wanderer";
  if (sub.status !== "active" && sub.status !== "canceled") return "wanderer";
  // No end date on an active row means a legacy/comped grant - honour it.
  if (sub.status === "active" && !sub.currentPeriodEnd) return "voyager";
  if (!sub.currentPeriodEnd) return "wanderer";
  // Both sides are YYYY-MM-DD, so a lexicographic compare is a date compare.
  // Inclusive: access lasts through the whole final day.
  return sub.currentPeriodEnd >= new Date().toISOString().slice(0, 10) ? "voyager" : "wanderer";
}
