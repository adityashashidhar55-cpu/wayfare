import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";

/** Membership guard - same rule as trip-router's requireMembership. */
async function requireTripMembership(tripId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tripMembers)
    .where(
      and(
        eq(schema.tripMembers.tripId, tripId),
        eq(schema.tripMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this trip" });
  }
  return rows[0];
}

/** Positions older than this are flagged `stale` by tripMemberLocations. */
const LOCATION_STALE_MS = 5 * 60 * 1000;

/**
 * Geo/arrival queries - location-aware helpers for the client arrival watcher.
 */
export const geoRouter = createRouter({
  /**
   * All of the current user's stops scheduled TODAY (server date), across
   * every trip they own or belong to. Only stops with coordinates are
   * returned - the client haversines against these to detect arrivals.
   */
  todayStops: authedQuery.query(async ({ ctx }) => {
    const db = getDb();

    const memberships = await db
      .select({ tripId: schema.tripMembers.tripId })
      .from(schema.tripMembers)
      .where(eq(schema.tripMembers.userId, ctx.user.id));
    const tripIds = memberships.map((m) => m.tripId);
    if (!tripIds.length) return [];

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, server date
    const days = await db
      .select()
      .from(schema.tripDays)
      .where(
        and(
          inArray(schema.tripDays.tripId, tripIds),
          eq(schema.tripDays.date, today),
        ),
      );
    if (!days.length) return [];

    const dayIds = days.map((d) => d.id);
    const [stopRows, tripRows] = await Promise.all([
      db
        .select()
        .from(schema.stops)
        .where(
          and(
            inArray(schema.stops.dayId, dayIds),
            isNotNull(schema.stops.lat),
            isNotNull(schema.stops.lng),
          ),
        ),
      db.select().from(schema.trips).where(inArray(schema.trips.id, tripIds)),
    ]);
    const tripTitleById = new Map(tripRows.map((t) => [t.id, t.title]));

    return stopRows
      .flatMap((s) => {
        if (s.lat == null || s.lng == null) return [];
        return [
          {
            stopId: s.id,
            tripId: s.tripId,
            tripTitle: tripTitleById.get(s.tripId) ?? "Trip",
            stopName: s.name,
            lat: s.lat,
            lng: s.lng,
            category: s.category,
            startTime: s.startTime,
          },
        ];
      })
      .sort((a, b) => {
        // Chronological by start time; untimed stops last.
        if (a.startTime == null && b.startTime == null) return 0;
        if (a.startTime == null) return 1;
        if (b.startTime == null) return -1;
        return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
      });
  }),

  /**
   * Live location sharing opt-in/out + position updates. The caller must be a
   * member of the trip. Upserts the (tripId, userId) row: while sharing, lat
   * and lng are required; turning sharing off keeps the last known position
   * but flips the flag so tripMemberLocations stops broadcasting it.
   */
  shareMyLocation: authedQuery
    .input(
      z
        .object({
          tripId: z.number().int().positive(),
          lat: z.number().min(-90).max(90).optional(),
          lng: z.number().min(-180).max(180).optional(),
          sharing: z.boolean(),
        })
        .refine((v) => !v.sharing || (v.lat != null && v.lng != null), {
          message: "lat and lng are required while sharing",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTripMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const now = new Date();
      await db
        .insert(schema.locationShares)
        .values({
          tripId: input.tripId,
          userId: ctx.user.id,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          sharing: input.sharing,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            // A sharing:false ping carries no fix - keep the stored one.
            ...(input.lat != null ? { lat: input.lat } : {}),
            ...(input.lng != null ? { lng: input.lng } : {}),
            sharing: input.sharing,
            updatedAt: now,
          },
        });
      return { ok: true as const, sharing: input.sharing };
    }),

  /**
   * Live positions of trip members who are currently sharing, joined with
   * their display name and trip presence color. `stale` marks fixes older
   * than 5 minutes (client greys them out); `ageMs` powers the "x min ago"
   * tooltip. Membership-guarded, like every trip-scoped query.
   */
  tripMemberLocations: authedQuery
    .input(z.object({ tripId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireTripMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const rows = await db
        .select({
          userId: schema.locationShares.userId,
          lat: schema.locationShares.lat,
          lng: schema.locationShares.lng,
          updatedAt: schema.locationShares.updatedAt,
          name: schema.tripMembers.name,
          presenceColor: schema.tripMembers.presenceColor,
        })
        .from(schema.locationShares)
        .innerJoin(
          schema.tripMembers,
          and(
            eq(schema.tripMembers.tripId, schema.locationShares.tripId),
            eq(schema.tripMembers.userId, schema.locationShares.userId),
          ),
        )
        .where(
          and(
            eq(schema.locationShares.tripId, input.tripId),
            eq(schema.locationShares.sharing, true),
          ),
        );
      const now = Date.now();
      const locations = rows
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => {
          const ageMs = Math.max(0, now - new Date(r.updatedAt).getTime());
          return {
            userId: r.userId,
            name: r.name,
            presenceColor: r.presenceColor,
            lat: r.lat as number,
            lng: r.lng as number,
            updatedAt: r.updatedAt,
            ageMs,
            stale: ageMs > LOCATION_STALE_MS,
          };
        });
      return { locations };
    }),
});
