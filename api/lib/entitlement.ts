/**
 * entitlement.ts (r27) - the one place a paid tier is granted.
 *
 * Both the client confirm handoff and the Razorpay webhook end up here, so
 * there is a single audited path from "money arrived" to "tier is voyager".
 * Idempotent: a payment row already marked `paid` returns without touching the
 * subscription, which matters because Razorpay retries webhooks and the client
 * confirm frequently races the first delivery.
 */
import { and, eq, ne } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { getSubscription } from "../queries/subscriptions";
import { notify } from "./notify";

export interface ActivateInput {
  userId: number;
  orderId: string;
  paymentId: string;
  interval: "monthly" | "yearly";
  source: "client" | "webhook";
  raw?: unknown;
}

/**
 * Mark the payment paid and extend the subscription.
 *
 * Extension, not replacement: if the user still has paid time left (they
 * renewed early, or upgraded monthly -> yearly), the new period is added to
 * the existing end date rather than overwriting it and silently eating the
 * remainder they already paid for.
 */
export async function activateVoyager(input: ActivateInput): Promise<{ activated: boolean; periodEnd: string }> {
  const db = getDb();

  // Claim the payment row with a conditional update: only rows not already
  // `paid` flip. affectedRows tells us whether we won. Read-then-write here
  // would let a webhook retry and the client confirm both grant a period.
  const claim = await db
    .update(schema.payments)
    .set({
      status: "paid",
      paymentId: input.paymentId,
      raw: input.raw ? JSON.stringify(input.raw).slice(0, 60_000) : null,
    })
    .where(
      and(
        eq(schema.payments.orderId, input.orderId),
        eq(schema.payments.userId, input.userId),
        ne(schema.payments.status, "paid"),
      ),
    );
  // getDb() is drizzle-orm/mysql2, so execute results are the raw mysql2
  // tuple and the count is `affectedRows`, not `rowsAffected`.
  const claimed = Number((claim as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);

  const sub = await getSubscription(input.userId);
  if (claimed < 1) {
    // Already activated by the other path. Report the existing period.
    return { activated: false, periodEnd: sub.currentPeriodEnd ?? todayIso() };
  }

  const base = laterOf(sub.currentPeriodEnd, todayIso());
  const periodEnd = addPeriod(base, input.interval);

  await db
    .update(schema.subscriptions)
    .set({ tier: "voyager", status: "active", currentPeriodEnd: periodEnd })
    .where(eq(schema.subscriptions.userId, input.userId));

  await notify(input.userId, {
    kind: "reward",
    title: "Voyager is active",
    body: `Thanks for upgrading. Your plan runs through ${periodEnd}.`,
  });

  return { activated: true, periodEnd };
}

/** Mark a payment failed. Never grants anything. */
export async function markPaymentFailed(orderId: string, raw?: unknown): Promise<void> {
  try {
    await getDb()
      .update(schema.payments)
      .set({
        status: "failed",
        raw: raw ? JSON.stringify(raw).slice(0, 60_000) : null,
      })
      .where(and(eq(schema.payments.orderId, orderId), ne(schema.payments.status, "paid")));
  } catch (e) {
    console.warn("markPaymentFailed", e);
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function laterOf(a: string | null, b: string): string {
  if (!a) return b;
  return a > b ? a : b;
}

/**
 * Add one billing period to a YYYY-MM-DD date.
 *
 * Uses UTC date arithmetic and clamps the day, so 31 Jan + 1 month is 28/29
 * Feb rather than JS's default roll-forward into March.
 */
function addPeriod(fromIso: string, interval: "monthly" | "yearly"): string {
  const [y, m, d] = fromIso.split("-").map(Number) as [number, number, number];
  const targetYear = interval === "yearly" ? y + 1 : m === 12 ? y + 1 : y;
  const targetMonth = interval === "yearly" ? m : m === 12 ? 1 : m + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const __test = { addPeriod, laterOf };
