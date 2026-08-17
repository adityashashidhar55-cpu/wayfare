/**
 * Support router (r10-support): the Voyager help channel behind the floating
 * support widget. Paid members file categorized tickets when the FAQ doesn't
 * cover their issue; the admin team works the queue from the Admin → Support
 * tab (see admin-router.ts). Deliberately simple - a human replies by email,
 * no AI bot.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { getTier } from "./queries/subscriptions";

/** Categories mirrored in the widget picker + admin stats chips. Keep in sync with db comment. */
export const SUPPORT_CATEGORIES = [
  "booking",
  "routes",
  "weather",
  "kids",
  "account",
  "app",
  "bug",
  "other",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

const submitInput = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  message: z.string().trim().min(10, "Please give us a little more detail (10+ characters).").max(2000),
  email: z
    .string()
    .trim()
    .email("That email doesn't look right.")
    .max(320)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const supportRouter = createRouter({
  /**
   * File a support ticket. Voyager-only - Wanderers get UPGRADE_REQUIRED so
   * the widget can show its upgrade line instead.
   */
  submitTicket: authedQuery.input(submitInput).mutation(async ({ ctx, input }) => {
    const tier = await getTier(ctx.user.id);
    if (tier !== "voyager") {
      throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
    }
    const db = getDb();
    const res = await db.insert(schema.supportTickets).values({
      userId: ctx.user.id,
      category: input.category,
      message: input.message,
      email: input.email ?? ctx.user.email ?? null,
    });
    const id = Number(res[0].insertId);
    const [ticket] = await db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.id, id))
      .limit(1);
    return { ok: true as const, ticket };
  }),

  /** The signed-in user's own tickets, newest first (any tier may read history). */
  myTickets: authedQuery.query(async ({ ctx }) => {
    const tickets = await getDb()
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.userId, ctx.user.id))
      .orderBy(desc(schema.supportTickets.createdAt))
      .limit(50);
    return { tickets };
  }),
});
