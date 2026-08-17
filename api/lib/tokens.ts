/**
 * tokens.ts (r24-smart, feature Q) - the token ledger. Balance is
 * SUM(amount); every earn is idempotent through a unique (userId, eventKey)
 * so retried mutations never double-pay.
 */
import { and, eq, gte, sql } from "drizzle-orm";
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
 * r25: per-day earn caps.
 *
 * Every earn is idempotent per eventKey, which stops a RETRY from double-
 * paying — but it does nothing about a user generating unlimited NEW events.
 * `wishlist.add` paid +10 with no cap on wishlist items, and `updateStop`
 * paid +5 for `booked: true` with no verification that a booking happened and
 * no cap on stops. A ten-line script calling those tRPC procedures in a loop
 * minted tokens without limit.
 *
 * Caps are per user per calendar day (UTC — the exact boundary doesn't matter
 * for an anti-abuse limit). Actions a user can only do a few times legitimately
 * are capped tightly; unlisted kinds are uncapped.
 */
export const DAILY_EARN_CAPS: Partial<Record<EarnKind, number>> = {
  wishlist_added: 5,
  stop_booked: 10,
  day_finalized: 10,
  trip_created: 3,
  trip_published: 3,
  join_accepted: 10,
  friend_session: 5,
};

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
    const cap = DAILY_EARN_CAPS[kind];
    if (cap != null) {
      const [row] = await getDb()
        .select({ n: sql<string>`COUNT(*)` })
        .from(schema.tokenEvents)
        .where(
          and(
            eq(schema.tokenEvents.userId, userId),
            eq(schema.tokenEvents.kind, kind),
            gte(schema.tokenEvents.createdAt, startOfUtcDay()),
          ),
        );
      if (Number(row?.n ?? 0) >= cap) return false;
    }
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

/** Midnight UTC today, for the daily earn-cap window. */
function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Outcome of a spend attempt, so callers can tell "broke" from "already done". */
export type SpendResult = "ok" | "insufficient" | "duplicate" | "error";

/**
 * Record a spend (negative amount), idempotent by eventKey.
 *
 * r25: the balance check and the ledger insert now happen inside ONE
 * transaction that re-reads the balance with `FOR UPDATE`.
 *
 * The old flow was: tokens-router read the balance with a plain SUM(), checked
 * it, and only afterwards called this function to insert. Two concurrent
 * redeems of DIFFERENT rewards both passed the check before either insert
 * landed (the per-reward eventKey made them non-duplicates), so a user with 60
 * tokens could redeem a 60-token and a 50-token reward at once and end at -50.
 */
export async function spendTokens(
  userId: number,
  amount: number,
  eventKey: string,
  meta?: Record<string, unknown>,
): Promise<SpendResult> {
  const cost = Math.abs(amount);
  try {
    return await getDb().transaction(async (tx) => {
      // FOR UPDATE locks the user's ledger rows for the life of the
      // transaction, so a concurrent redeem blocks here instead of racing.
      const [row] = await tx
        .select({ sum: sql<string>`COALESCE(SUM(amount), 0)` })
        .from(schema.tokenEvents)
        .where(eq(schema.tokenEvents.userId, userId))
        .for("update");
      const balance = Number(row?.sum ?? 0);
      if (balance < cost) return "insufficient";

      await tx.insert(schema.tokenEvents).values({
        userId,
        kind: "redeem",
        amount: -cost,
        eventKey: eventKey.slice(0, 128),
        meta: meta ? JSON.stringify(meta) : null,
      });
      return "ok";
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate/i.test(msg)) return "duplicate";
    console.warn("spendTokens failed", e);
    return "error";
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
