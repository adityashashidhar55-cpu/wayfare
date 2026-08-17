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

export async function getTier(userId: number): Promise<TierName> {
  const sub = await getSubscription(userId);
  return sub.status === "active" ? (sub.tier as TierName) : "wanderer";
}
