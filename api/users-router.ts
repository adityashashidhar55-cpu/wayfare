/**
 * users router (r24-smart) - the canonical client-facing "who am I, what tier
 * am I on" endpoint. `auth.me` stays the session source; `users.me` adds the
 * subscription tier so every premium gate on the client reads one place.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@db/schema";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { getTier } from "./queries/subscriptions";
import { isValidTimeZone } from "./lib/tz";

export const usersRouter = createRouter({
  me: authedQuery.query(async ({ ctx }) => {
    const tier = await getTier(ctx.user.id);
    return {
      user: {
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        avatar: ctx.user.avatar,
        role: ctx.user.role,
        timezone: ctx.user.timezone,
      },
      tier,
      isPremium: tier === "voyager",
    };
  }),

  /**
   * r25: record the browser's IANA timezone.
   *
   * Every date boundary in the API (trip status, today's stops, travel mode)
   * is now resolved in a real zone rather than the server's UTC clock - see
   * api/lib/tz.ts. Trips carry the destination's zone; this is the per-user
   * fallback for everything else.
   *
   * The client sends Intl.DateTimeFormat().resolvedOptions().timeZone once
   * after sign-in. Unrecognised values are rejected rather than stored, so a
   * spoofed or stale zone name can't poison later date maths.
   */
  setTimezone: authedQuery
    .input(z.object({ timezone: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      if (!isValidTimeZone(input.timezone)) {
        return { ok: false as const, reason: "unrecognised_timezone" };
      }
      if (ctx.user.timezone === input.timezone) return { ok: true as const };
      await getDb()
        .update(schema.users)
        .set({ timezone: input.timezone })
        .where(eq(schema.users.id, ctx.user.id));
      return { ok: true as const };
    }),
});
