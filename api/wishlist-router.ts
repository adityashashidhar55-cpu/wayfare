/**
 * wishlist router (r24-smart, feature O) - unplanned want-to-do trips.
 * Adding to the wishlist is free; the best-time advisor is premium.
 */
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter, premiumQuery } from "./middleware";
import { bestTimeFor } from "./lib/best-time";
import { awardTokens } from "./lib/tokens";

export const wishlistRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const rows = await getDb()
      .select()
      .from(schema.wishlistTrips)
      .where(eq(schema.wishlistTrips.userId, ctx.user.id))
      .orderBy(desc(schema.wishlistTrips.id));
    return { items: rows };
  }),

  add: authedQuery
    .input(
      z.object({
        title: z.string().trim().min(1).max(255),
        destination: z.string().trim().min(1).max(255),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.insert(schema.wishlistTrips).values({
        userId: ctx.user.id,
        title: input.title,
        destination: input.destination,
        notes: input.notes ?? null,
      });
      const id = Number(result[0].insertId);
      await awardTokens(ctx.user.id, "wishlist_added", `wishlist:${id}`, { destination: input.destination });
      return { id };
    }),

  remove: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.wishlistTrips)
        .where(and(eq(schema.wishlistTrips.id, input.id), eq(schema.wishlistTrips.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Wishlist trip not found" });
      await db.delete(schema.wishlistTrips).where(eq(schema.wishlistTrips.id, input.id));
      return { ok: true };
    }),

  /** Premium: best-time advisor for one destination string. */
  bestTime: premiumQuery
    .input(z.object({ destination: z.string().trim().min(1).max(255) }))
    .query(({ input }) => bestTimeFor(input.destination)),
});
