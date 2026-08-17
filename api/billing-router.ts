import { eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { getSubscription } from "./queries/subscriptions";
import { VOYAGER_PRICE } from "@contracts/premium";

export const billingRouter = createRouter({
  /** Current subscription status (auto-creates free tier on first call). */
  status: authedQuery.query(async ({ ctx }) => {
    const sub = await getSubscription(ctx.user.id);
    return { subscription: sub, prices: VOYAGER_PRICE };
  }),

  /**
   * Mock checkout - Stripe-ready seam. In production this would create a
   * Stripe Checkout Session and webhook-confirmed activation; here it
   * activates Voyager immediately so the full premium flow is exercisable.
   */
  checkout: authedQuery
    .input(z.object({ interval: z.enum(["monthly", "yearly"]) }))
    .mutation(async ({ ctx, input }) => {
      await getSubscription(ctx.user.id);
      const periodEnd = new Date();
      if (input.interval === "yearly") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      else periodEnd.setMonth(periodEnd.getMonth() + 1);
      await getDb()
        .update(schema.subscriptions)
        .set({
          tier: "voyager",
          status: "active",
          currentPeriodEnd: periodEnd.toISOString().slice(0, 10),
        })
        .where(eq(schema.subscriptions.userId, ctx.user.id));
      return { ok: true, tier: "voyager" as const, interval: input.interval };
    }),

  cancel: authedQuery.mutation(async ({ ctx }) => {
    await getSubscription(ctx.user.id);
    await getDb()
      .update(schema.subscriptions)
      .set({ tier: "wanderer", status: "active", currentPeriodEnd: null })
      .where(eq(schema.subscriptions.userId, ctx.user.id));
    return { ok: true, tier: "wanderer" as const };
  }),
});
