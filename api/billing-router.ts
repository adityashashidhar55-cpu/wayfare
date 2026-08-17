/**
 * billing-router (r27) - real payments, replacing the mock.
 *
 * What was here before: `checkout` set tier = "voyager" and returned ok, with
 * no money, no provider and no verification. Anyone who could call the
 * procedure had Voyager for free, and `currentPeriodEnd` was written but never
 * read, so the grant never expired either.
 *
 * Now: create an order server-side at a server-chosen price, and grant the
 * entitlement only against an HMAC signature the browser cannot forge. See
 * api/lib/razorpay.ts for the trust model.
 */
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { getSubscription } from "./queries/subscriptions";
import { priceFor, PRICES, VOYAGER_PRICE } from "@contracts/premium";
import { env, paymentsEnabled } from "./lib/env";
import {
  createOrder,
  PaymentProviderError,
  verifyCheckoutSignature,
} from "./lib/razorpay";
import { activateVoyager } from "./lib/entitlement";

export const billingRouter = createRouter({
  /** Current subscription status (auto-creates free tier on first call). */
  status: authedQuery.query(async ({ ctx }) => {
    const sub = await getSubscription(ctx.user.id);
    const prices = priceFor({ timezone: ctx.user.timezone });
    return {
      subscription: sub,
      // Legacy field name kept so existing callers don't break.
      prices: VOYAGER_PRICE,
      priceTable: prices,
      paymentsEnabled: paymentsEnabled(),
    };
  }),

  /**
   * Step 1: create a Razorpay order. Returns everything Checkout needs.
   *
   * The price is resolved HERE from the user's market, not accepted from the
   * client - otherwise a caller could order Voyager for 1 paisa.
   */
  createOrder: authedQuery
    .input(z.object({ interval: z.enum(["monthly", "yearly"]) }))
    .mutation(async ({ ctx, input }) => {
      if (!paymentsEnabled()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Payments aren't switched on for this deployment yet.",
        });
      }
      await getSubscription(ctx.user.id);
      const table = priceFor({ timezone: ctx.user.timezone });
      const amountMinor = table[input.interval].cents;

      let order;
      try {
        order = await createOrder({
          amountMinor,
          currency: table.currency,
          receipt: `wf-${ctx.user.id}-${Date.now().toString(36)}`,
          notes: { userId: String(ctx.user.id), interval: input.interval },
        });
      } catch (e) {
        const message =
          e instanceof PaymentProviderError ? e.message : "Could not start that payment";
        throw new TRPCError({ code: "BAD_GATEWAY", message });
      }

      await getDb().insert(schema.payments).values({
        userId: ctx.user.id,
        provider: "razorpay",
        orderId: order.id,
        amount: amountMinor,
        currency: table.currency,
        interval: input.interval,
        status: "created",
      });

      return {
        orderId: order.id,
        amount: amountMinor,
        currency: table.currency,
        // Publishable key - safe to expose, it is the same value embedded in
        // the Checkout script tag on every Razorpay integration.
        keyId: env.razorpayKeyId,
        interval: input.interval,
        label: table[input.interval].label,
      };
    }),

  /**
   * Step 2: the browser hands back what Checkout gave it. We verify the
   * signature with a secret the browser has never seen, then activate.
   *
   * The webhook does this too and is authoritative; this exists so the UI
   * flips to Voyager immediately instead of waiting on webhook delivery.
   * activateVoyager is idempotent, so both landing is harmless.
   */
  confirm: authedQuery
    .input(
      z.object({
        orderId: z.string().min(4).max(64),
        paymentId: z.string().min(4).max(64),
        signature: z.string().min(16).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.orderId, input.orderId),
            // Scope to the caller. Without this a user could confirm somebody
            // else's order id and move THEIR subscription around.
            eq(schema.payments.userId, ctx.user.id),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown order" });

      if (!verifyCheckoutSignature(input)) {
        await db
          .update(schema.payments)
          .set({ status: "failed", raw: JSON.stringify({ reason: "bad_signature" }) })
          .where(eq(schema.payments.id, row.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment could not be verified" });
      }

      await activateVoyager({
        userId: row.userId,
        orderId: row.orderId,
        paymentId: input.paymentId,
        interval: row.interval,
        source: "client",
      });
      const sub = await getSubscription(ctx.user.id);
      return { ok: true, tier: sub.tier, currentPeriodEnd: sub.currentPeriodEnd };
    }),

  /** Payment history for the billing page. */
  history: authedQuery.query(async ({ ctx }) => {
    const rows = await getDb()
      .select({
        id: schema.payments.id,
        amount: schema.payments.amount,
        currency: schema.payments.currency,
        interval: schema.payments.interval,
        status: schema.payments.status,
        createdAt: schema.payments.createdAt,
      })
      .from(schema.payments)
      .where(eq(schema.payments.userId, ctx.user.id))
      .orderBy(desc(schema.payments.id))
      .limit(24);
    return { rows };
  }),

  /**
   * Cancel. Keeps Voyager until the paid period actually ends rather than
   * revoking immediately - the customer paid through that date.
   */
  cancel: authedQuery.mutation(async ({ ctx }) => {
    const sub = await getSubscription(ctx.user.id);
    const stillPaid = sub.currentPeriodEnd && sub.currentPeriodEnd >= new Date().toISOString().slice(0, 10);
    await getDb()
      .update(schema.subscriptions)
      .set(
        stillPaid
          ? { status: "canceled" } // tier stays voyager; getTier honours the end date
          : { tier: "wanderer", status: "active", currentPeriodEnd: null },
      )
      .where(eq(schema.subscriptions.userId, ctx.user.id));
    return {
      ok: true,
      tier: stillPaid ? ("voyager" as const) : ("wanderer" as const),
      accessUntil: stillPaid ? sub.currentPeriodEnd : null,
    };
  }),
});

export { PRICES };
