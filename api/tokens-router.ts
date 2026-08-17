/**
 * tokens router (r24-smart, feature Q) - balance chip, history, the virtual
 * rewards catalog and redemption. Earn side lives in api/lib/tokens.ts and
 * is hooked into existing procedures.
 */
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { rewardById, REWARDS } from "./lib/rewards";
import { spendTokens, tokenBalance } from "./lib/tokens";
import { notify } from "./lib/notify";

export const tokensRouter = createRouter({
  /** Balance + recent ledger for the header chip and /rewards page. */
  state: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const balance = await tokenBalance(ctx.user.id);
    const history = await db
      .select()
      .from(schema.tokenEvents)
      .where(eq(schema.tokenEvents.userId, ctx.user.id))
      .orderBy(desc(schema.tokenEvents.id))
      .limit(30);
    const redeemed = await db
      .select()
      .from(schema.rewardsRedeemed)
      .where(eq(schema.rewardsRedeemed.userId, ctx.user.id))
      .orderBy(desc(schema.rewardsRedeemed.id));
    return { balance, history, redeemed, catalog: REWARDS };
  }),

  /** Redeem a virtual reward; spends tokens and drops a notification. */
  redeem: authedQuery
    .input(z.object({ rewardId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const reward = rewardById(input.rewardId);
      if (!reward) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown reward" });
      const db = getDb();
      // Cheap pre-check for a friendly error. The AUTHORITATIVE check is
      // inside spendTokens' transaction below - doing it only here is what
      // allowed two concurrent redeems to both pass and overdraw the balance.
      const balance = await tokenBalance(ctx.user.id);
      if (balance < reward.cost) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not enough tokens yet" });
      }
      const [already] = await db
        .select()
        .from(schema.rewardsRedeemed)
        .where(
          and(
            eq(schema.rewardsRedeemed.userId, ctx.user.id),
            eq(schema.rewardsRedeemed.rewardId, reward.id),
          ),
        )
        .limit(1);
      if (already) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already on your shelf" });
      }
      const spent = await spendTokens(ctx.user.id, reward.cost, `redeem:${reward.id}`, {
        name: reward.name,
      });
      if (spent === "insufficient") {
        // Lost a race with a concurrent redeem - the balance was enough when
        // we pre-checked and isn't any more.
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not enough tokens yet" });
      }
      if (spent === "duplicate") {
        throw new TRPCError({ code: "CONFLICT", message: "Redemption already recorded" });
      }
      if (spent !== "ok") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not record that redemption" });
      }
      await db.insert(schema.rewardsRedeemed).values({
        userId: ctx.user.id,
        rewardId: reward.id,
        cost: reward.cost,
      });
      await notify(ctx.user.id, {
        kind: "reward",
        title: `${reward.name} unlocked`,
        body: `You spent ${reward.cost} tokens. Find it on your rewards shelf.`,
      });
      return { ok: true, balance: balance - reward.cost };
    }),
});
