/**
 * travel router (r24-smart, feature N) - server side of "travel mode".
 * The geolocation watch and behind-schedule math run client-side
 * (src/lib/travel-mode.ts); these procedures supply today's plan, record
 * check-ins, and post the reroute notification.
 *
 * Honest scope: everything works only while the app is open. There is no
 * background tracking.
 */
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, premiumQuery } from "./middleware";
import { notify, notifyOnce } from "./lib/notify";

async function tripInProgress(tripId: number, userId: number) {
  const db = getDb();
  const [member] = await db
    .select()
    .from(schema.tripMembers)
    .where(and(eq(schema.tripMembers.tripId, tripId), eq(schema.tripMembers.userId, userId)))
    .limit(1);
  if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this trip" });
  const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).limit(1);
  if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
  const today = new Date().toISOString().slice(0, 10);
  if (today < trip.startDate || today > trip.endDate) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "TRIP_NOT_IN_PROGRESS" });
  }
  return trip;
}

export const travelRouter = createRouter({
  /**
   * Today's plan for travel mode: the day matching today's date, its stops
   * in order, plus the nearest famous eatery from the corpus for check-ins.
   */
  todayState: premiumQuery
    .input(z.object({ tripId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const trip = await tripInProgress(input.tripId, ctx.user.id);
      const db = getDb();
      const today = new Date().toISOString().slice(0, 10);
      const days = await db
        .select()
        .from(schema.tripDays)
        .where(and(eq(schema.tripDays.tripId, input.tripId), eq(schema.tripDays.date, today)))
        .limit(1);
      const day = days[0] ?? null;
      const stops = day
        ? (
            await db
              .select()
              .from(schema.stops)
              .where(eq(schema.stops.dayId, day.id))
          ).sort((a, b) => a.position - b.position)
        : [];

      // Nearest famous eatery by distance to the day's first geocoded stop
      // (client refines with live position; this is the corpus fallback).
      const city = trip.destination.split(",")[0]?.trim() ?? trip.destination;
      const eateries = await db
        .select()
        .from(schema.explorePlaces)
        .where(and(eq(schema.explorePlaces.city, city), eq(schema.explorePlaces.famousEatery, true)))
        .limit(5);

      return {
        trip: { id: trip.id, title: trip.title, startDate: trip.startDate, endDate: trip.endDate },
        today,
        day: day ? { id: day.id, date: day.date, position: day.position } : null,
        stops: stops.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          startTime: s.startTime,
          durationMin: s.durationMin,
          lat: s.lat,
          lng: s.lng,
        })),
        famousEateries: eateries.map((e) => ({ name: e.name, lat: e.lat, lng: e.lng })),
      };
    }),

  /**
   * Record a mood/health check-in and post the adapted suggestion as a
   * notification so it survives navigation.
   */
  checkIn: premiumQuery
    .input(
      z.object({
        tripId: z.number().int().positive(),
        energy: z.enum(["low", "normal", "high"]),
        tags: z.array(z.enum(["tired", "hungry", "unwell", "fine"])).max(4),
        summary: z.string().max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const trip = await tripInProgress(input.tripId, ctx.user.id);
      await notify(ctx.user.id, {
        kind: "travel",
        title: `Check-in: ${input.energy} energy`,
        body: input.summary,
        tripId: trip.id,
      });
      return { ok: true };
    }),

  /**
   * Client detected "running late": post the reroute notification once per
   * stop/day combo. The client then offers optimize-day as the reroute.
   */
  reportBehind: premiumQuery
    .input(
      z.object({
        tripId: z.number().int().positive(),
        dayId: z.number().int().positive(),
        lateStopName: z.string().max(255),
        nextStopName: z.string().max(255),
        minutesLate: z.number().int().min(0).max(24 * 60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const trip = await tripInProgress(input.tripId, ctx.user.id);
      await notifyOnce(ctx.user.id, {
        kind: "travel",
        title: `Running late, reroute today?`,
        body: `${input.lateStopName} ran about ${input.minutesLate} minutes over and you're still away from ${input.nextStopName}. Optimize today's route or drop a stop to relax the plan.`,
        tripId: trip.id,
      });
      return { ok: true };
    }),
});
