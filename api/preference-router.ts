import { eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";

async function ensurePreferences(userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.preferences)
    .where(eq(schema.preferences.userId, userId))
    .limit(1);
  if (rows[0]) return rows[0];
  await db.insert(schema.preferences).values({
    userId,
    styles: [],
    interests: [],
    cuisines: [],
  });
  const created = await db
    .select()
    .from(schema.preferences)
    .where(eq(schema.preferences.userId, userId))
    .limit(1);
  return created[0]!;
}

export const preferenceRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    return ensurePreferences(ctx.user.id);
  }),

  upsert: authedQuery
    .input(
      z.object({
        styles: z.array(z.string()).optional(),
        budgetBand: z.string().max(32).optional(),
        pace: z.string().max(32).optional(),
        interests: z.array(z.string()).optional(),
        cuisines: z.array(z.string()).optional(),
        dietary: z.enum(["veg", "non-veg", "vegan", "jain", "eggetarian"]).optional(),
        companions: z.string().max(32).optional(),
        homeCurrency: z.string().length(3).optional(),
        archetype: z.string().max(64).optional(),
        onboardingDone: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensurePreferences(ctx.user.id);
      await getDb()
        .update(schema.preferences)
        .set(input)
        .where(eq(schema.preferences.userId, ctx.user.id));
      return { ok: true };
    }),
});
