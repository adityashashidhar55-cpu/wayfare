/**
 * tokens.ts (r24-smart, feature Q) - the token ledger. Balance is
 * SUM(amount); every earn is idempotent through a unique (userId, eventKey)
 * so retried mutations never double-pay.
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";

/** Earn rules - one row per action the app rewards. */
export const EARN_AMOUNTS = {
  trip_created: 20,
  trip_published: 30,
  join_accepted: 15,
  stop_booked: 5,
  friend_session: 25,
  wishlist_added: 10,
  day_finalized: 10,
} as const;

export type EarnKind = keyof typeof EARN_AMOUNTS;

/**
 * Award tokens once per eventKey. Returns true when the award landed, false
 * when it already existed (idempotent no-op). Never throws - a token hiccup
 * must not fail the underlying action.
 */
export async function awardTokens(
  userId: number,
  kind: EarnKind,
  eventKey: string,
  meta?: Record<string, unknown>,
): Promise<boolean> {
  try {
    await getDb().insert(schema.tokenEvents).values({
      userId,
      kind,
      amount: EARN_AMOUNTS[kind],
      eventKey: eventKey.slice(0, 128),
      meta: meta ? JSON.stringify(meta) : null,
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate/i.test(msg)) return false;
    console.warn("awardTokens failed", e);
    return false;
  }
}

/** Record a spend (negative amount); also idempotent by eventKey. */
export async function spendTokens(
  userId: number,
  amount: number,
  eventKey: string,
  meta?: Record<string, unknown>,
): Promise<boolean> {
  try {
    await getDb().insert(schema.tokenEvents).values({
      userId,
      kind: "redeem",
      amount: -Math.abs(amount),
      eventKey: eventKey.slice(0, 128),
      meta: meta ? JSON.stringify(meta) : null,
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate/i.test(msg)) return false;
    console.warn("spendTokens failed", e);
    return false;
  }
}

/** Current balance = SUM(amount). */
export async function tokenBalance(userId: number): Promise<number> {
  const [row] = await getDb()
    .select({ sum: sql<string>`COALESCE(SUM(amount), 0)` })
    .from(schema.tokenEvents)
    .where(eq(schema.tokenEvents.userId, userId));
  return Number(row?.sum ?? 0);
}
