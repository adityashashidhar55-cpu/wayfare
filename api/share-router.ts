import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import { requireEditor, requireMembership } from "./trip-router";
import { buildSharedFinances } from "./lib/shared-finances";
import { resolveDestination } from "./lib/destination";

/**
 * Public share links (r12-share). A trip gets a random shareToken; anyone with
 * the link can read a redacted, read-only itinerary at /shared/:token - no
 * member emails, no user/member ids, no internal trip id. NULL token = off.
 * r14-linkfix: the payload now also carries redacted finances (budget,
 * expenses by display name, per-person split summary) and a resolved
 * destination (country/coords) so the client can pick a region-true cover.
 */
export const shareRouter = createRouter({
  /** Current link state for the share dialog (any member can see it). */
  getShareState: authedQuery
    .input(z.object({ tripId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db
        .select({ shareToken: schema.trips.shareToken })
        .from(schema.trips)
        .where(eq(schema.trips.id, input.tripId))
        .limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
      return { enabled: trip.shareToken != null, token: trip.shareToken };
    }),

  /** Turn the public link on (editors+). Idempotent - keeps an existing token. */
  enableShareLink: authedQuery
    .input(z.object({ tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db
        .select({ shareToken: schema.trips.shareToken })
        .from(schema.trips)
        .where(eq(schema.trips.id, input.tripId))
        .limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
      if (trip.shareToken) return { token: trip.shareToken };
      const token = crypto.randomUUID();
      await db.update(schema.trips).set({ shareToken: token }).where(eq(schema.trips.id, input.tripId));
      return { token };
    }),

  /** Turn the public link off - the old URL immediately stops resolving. */
  disableShareLink: authedQuery
    .input(z.object({ tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      await getDb().update(schema.trips).set({ shareToken: null }).where(eq(schema.trips.id, input.tripId));
      return { ok: true };
    }),

  /**
   * PUBLIC (no auth): the read-only itinerary behind a share link. Redacted -
   * trip title/dates/destination/cover, days, stops (name/category/time/
   * duration/notes/image), and finances (budget, expenses, split summary)
   * attributed by DISPLAY NAME only. No emails, no user/member ids, no trip id.
   */
  getSharedTrip: publicQuery
    .input(z.object({ token: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [trip] = await db
        .select()
        .from(schema.trips)
        .where(eq(schema.trips.shareToken, input.token))
        .limit(1);
      if (!trip) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This share link is invalid or has been turned off.",
        });
      }
      const [days, stopRows, expenseRows, memberRows] = await Promise.all([
        db
          .select()
          .from(schema.tripDays)
          .where(eq(schema.tripDays.tripId, trip.id))
          .orderBy(asc(schema.tripDays.position)),
        db
          .select()
          .from(schema.stops)
          .where(eq(schema.stops.tripId, trip.id))
          .orderBy(asc(schema.stops.position)),
        db
          .select()
          .from(schema.expenses)
          .where(eq(schema.expenses.tripId, trip.id)),
        db
          .select({ id: schema.tripMembers.id, name: schema.tripMembers.name })
          .from(schema.tripMembers)
          .where(eq(schema.tripMembers.tripId, trip.id)),
      ]);
      const expenseIds = expenseRows.map((e) => e.id);
      const splitRows = expenseIds.length
        ? await db
            .select()
            .from(schema.expenseSplits)
            .where(inArray(schema.expenseSplits.expenseId, expenseIds))
        : [];

      const destination = resolveDestination(trip.destination);

      return {
        trip: {
          title: trip.title,
          destination: trip.destination,
          startDate: trip.startDate,
          endDate: trip.endDate,
          coverImage: trip.coverImage,
        },
        /** Resolved destination (country/coords) for a region-true cover pick. */
        destinationInfo: destination,
        days: days.map((d) => ({ id: d.id, date: d.date, position: d.position })),
        stops: stopRows.map((s) => ({
          id: s.id,
          dayId: s.dayId,
          name: s.name,
          category: s.category,
          startTime: s.startTime,
          durationMin: s.durationMin,
          notes: s.notes,
          image: s.image,
          position: s.position,
        })),
        finances: buildSharedFinances({
          budgetCents: trip.budgetCents,
          homeCurrency: trip.homeCurrency,
          expenses: expenseRows.map((e) => ({
            id: e.id,
            title: e.title,
            category: e.category,
            homeCents: e.homeCents,
            date: e.date,
            paidById: e.paidById,
          })),
          splits: splitRows.map((s) => ({
            expenseId: s.expenseId,
            memberId: s.memberId,
            shareCents: s.shareCents,
          })),
          members: memberRows,
        }),
      };
    }),
});
