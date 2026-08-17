/**
 * notifications router (r24-smart) - backs the AppShell bell: unread count,
 * recent list (polled every 30s by the client), mark-read.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { listNotifications } from "./lib/notify";

export const notificationsRouter = createRouter({
  /** Latest 20 + unread count (the bell polls this). */
  list: authedQuery.query(async ({ ctx }) => {
    const { rows, unread } = await listNotifications(ctx.user.id);
    return { notifications: rows, unread };
  }),

  markRead: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(schema.notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.notifications.id, input.id),
            eq(schema.notifications.userId, ctx.user.id),
          ),
        );
      return { ok: true };
    }),

  markAllRead: authedQuery.mutation(async ({ ctx }) => {
    await getDb()
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(schema.notifications.userId, ctx.user.id)));
    return { ok: true };
  }),
});
