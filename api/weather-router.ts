import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter, premiumQuery } from "./middleware";
import { geocodeCity } from "./queries/overpass";
import { getDayWeather, weatherLabel } from "./lib/weather";
import { forecastForDates } from "./lib/forecast";
import { analyzeForecast, type ForecastDay } from "./lib/weather-advice";
import { notify } from "./lib/notify";

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

export type TripWeatherRow = {
  dayId: number;
  date: string; // YYYY-MM-DD
  available: boolean; // false when Open-Meteo had nothing for this day
  tmaxC: number | null;
  tminC: number | null;
  precipMm: number | null;
  code: number | null; // WMO weather code
  label: string | null;
  icon: string | null;
  approximate: boolean; // true = 5-year climate normals, not a real forecast
};

export type TripWeatherResult = {
  /** Representative coordinate the weather was sampled at (null = unresolved). */
  location: { lat: number; lng: number; source: "stops" | "destination" } | null;
  rows: TripWeatherRow[];
  summary: {
    /** Every available row is approximate (trip is beyond the 16-day horizon). */
    approximateAll: boolean;
    /** Days with ≥1 mm precipitation. */
    rainyDays: number;
    hottestC: number | null;
    coldestC: number | null;
  };
};

function unavailableRow(dayId: number, date: string): TripWeatherRow {
  return {
    dayId,
    date,
    available: false,
    tmaxC: null,
    tminC: null,
    precipMm: null,
    code: null,
    label: null,
    icon: null,
    approximate: false,
  };
}

/**
 * Weather queries - forecast for trip dates, climate normals when the trip
 * is beyond the 16-day forecast horizon (api/lib/weather.ts does both).
 */
export const weatherRouter = createRouter({
  /**
   * Per-day weather for a trip: one representative coordinate (centroid of
   * the trip's stops, else the geocoded destination) sampled for every trip
   * day. Never throws on weather failures - days without data come back as
   * `available:false` rows so the UI can just skip the chip.
   */
  tripWeather: authedQuery
    .input(z.object({ tripId: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<TripWeatherResult> => {
      await requireTripMembership(input.tripId, ctx.user.id);
      const db = getDb();

      const [trip] = await db
        .select()
        .from(schema.trips)
        .where(eq(schema.trips.id, input.tripId))
        .limit(1);
      const days = await db
        .select()
        .from(schema.tripDays)
        .where(eq(schema.tripDays.tripId, input.tripId));

      const emptySummary = {
        approximateAll: false,
        rainyDays: 0,
        hottestC: null,
        coldestC: null,
      };
      if (!trip || days.length === 0) {
        return { location: null, rows: [], summary: emptySummary };
      }

      // Representative coordinate: centroid of geocoded stops, else the
      // destination name through Photon.
      let location: TripWeatherResult["location"] = null;
      const geoStops = (
        await db
          .select({ lat: schema.stops.lat, lng: schema.stops.lng })
          .from(schema.stops)
          .where(eq(schema.stops.tripId, input.tripId))
      ).filter((s): s is { lat: number; lng: number } => s.lat != null && s.lng != null);
      if (geoStops.length > 0) {
        location = {
          lat: geoStops.reduce((a, s) => a + s.lat, 0) / geoStops.length,
          lng: geoStops.reduce((a, s) => a + s.lng, 0) / geoStops.length,
          source: "stops",
        };
      } else {
        try {
          const geo = await geocodeCity(trip.destination);
          if (geo) location = { lat: geo.lat, lng: geo.lng, source: "destination" };
        } catch {
          // geocode failure → all rows unavailable
        }
      }

      const sorted = [...days].sort((a, b) => a.position - b.position);
      const rows: TripWeatherRow[] = location
        ? await Promise.all(
            sorted.map(async (day) => {
              const w = await getDayWeather(location.lat, location.lng, day.date);
              if (!w) return unavailableRow(day.id, day.date);
              const { label, icon } = weatherLabel(w.code);
              return {
                dayId: day.id,
                date: day.date,
                available: true,
                tmaxC: w.tmaxC,
                tminC: w.tminC,
                precipMm: w.precipMm,
                code: w.code,
                label,
                icon,
                approximate: w.approximate,
              };
            }),
          )
        : sorted.map((day) => unavailableRow(day.id, day.date));

      const ok = rows.filter((r) => r.available);
      const summary = {
        approximateAll: ok.length > 0 && ok.every((r) => r.approximate),
        rainyDays: ok.filter((r) => (r.precipMm ?? 0) >= 1).length,
        hottestC: ok.length ? Math.max(...ok.map((r) => r.tmaxC!)) : null,
        coldestC: ok.length ? Math.min(...ok.map((r) => r.tminC!)) : null,
      };

      return { location, rows, summary };
    }),

  /**
   * r24-smart K (premium): per-day conditions + analyzer flags + suggested
   * adaptations for the whole trip. Real Open-Meteo forecast inside 16 days,
   * typical-climate heuristics beyond (labeled approximate).
   */
  tripForecast: premiumQuery
    .input(z.object({ tripId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireTripMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db
        .select()
        .from(schema.trips)
        .where(eq(schema.trips.id, input.tripId))
        .limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
      const days = await db
        .select()
        .from(schema.tripDays)
        .where(eq(schema.tripDays.tripId, input.tripId));
      const sorted = [...days].sort((a, b) => a.position - b.position);

      // Representative coordinate: centroid of geocoded stops, else geocode.
      let location: { lat: number; lng: number } | null = null;
      const geoStops = (
        await db
          .select({ lat: schema.stops.lat, lng: schema.stops.lng })
          .from(schema.stops)
          .where(eq(schema.stops.tripId, input.tripId))
      ).filter((s): s is { lat: number; lng: number } => s.lat != null && s.lng != null);
      if (geoStops.length > 0) {
        location = {
          lat: geoStops.reduce((a, s) => a + s.lat, 0) / geoStops.length,
          lng: geoStops.reduce((a, s) => a + s.lng, 0) / geoStops.length,
        };
      } else {
        try {
          const geo = await geocodeCity(trip.destination);
          if (geo) location = { lat: geo.lat, lng: geo.lng };
        } catch {
          // fall through - rows come back empty
        }
      }

      const stopRows = await db
        .select()
        .from(schema.stops)
        .where(eq(schema.stops.tripId, input.tripId));
      // Outdoor heuristic: activity/shopping stops count as outdoors.
      const outdoorByDay = new Map<number, number>();
      for (const s of stopRows) {
        if (s.dayId == null) continue;
        if (s.category === "activity" || s.category === "shopping") {
          outdoorByDay.set(s.dayId, (outdoorByDay.get(s.dayId) ?? 0) + 1);
        }
      }

      const points = location
        ? await forecastForDates(location.lat, location.lng, sorted.map((d) => d.date))
        : [];
      const byDate = new Map(points.map((p) => [p.date, p]));

      const analyzerInput: ForecastDay[] = sorted.map((d) => {
        const p = byDate.get(d.date);
        return {
          dayId: d.id,
          date: d.date,
          tmaxC: p?.tmaxC ?? null,
          precipProbPct: p?.precipProbPct ?? null,
          approximate: p?.approximate ?? false,
          outdoorCount: outdoorByDay.get(d.id) ?? 0,
        };
      });
      const advice = analyzeForecast(analyzerInput);

      return {
        days: sorted.map((d, i) => ({
          dayId: d.id,
          position: i + 1,
          date: d.date,
          flexible: d.flexible,
          forecast: byDate.get(d.date) ?? null,
        })),
        flagged: advice.flagged,
        adaptations: advice.adaptations,
        approximateAll: advice.approximateAll,
        locationResolved: location != null,
      };
    }),

  /**
   * r24-smart K (premium): one-click apply of a weather adaptation.
   *  - swap: exchange the stop assignments of two days
   *  - indoor: replace an outdoor stop with an indoor alternative from the
   *    explore corpus (same city)
   *  - flexible: mark the day flexible ("decide on the morning of")
   * Every apply records a notification for the bell.
   */
  applyAdaptation: premiumQuery
    .input(
      z.object({
        tripId: z.number().int().positive(),
        kind: z.enum(["swap", "indoor", "flexible"]),
        dayId: z.number().int().positive(),
        withDayId: z.number().int().positive().optional(),
        stopId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTripMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db
        .select()
        .from(schema.trips)
        .where(eq(schema.trips.id, input.tripId))
        .limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });

      if (input.kind === "swap") {
        if (!input.withDayId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "withDayId is required for swap" });
        }
        const dayStops = await db
          .select()
          .from(schema.stops)
          .where(eq(schema.stops.tripId, input.tripId));
        const a = dayStops.filter((s) => s.dayId === input.dayId);
        const b = dayStops.filter((s) => s.dayId === input.withDayId);
        for (const s of a) {
          await db.update(schema.stops).set({ dayId: input.withDayId }).where(eq(schema.stops.id, s.id));
        }
        for (const s of b) {
          await db.update(schema.stops).set({ dayId: input.dayId }).where(eq(schema.stops.id, s.id));
        }
        await notify(ctx.user.id, {
          kind: "weather",
          title: "Days swapped for better weather",
          body: `Day plans were exchanged on “${trip.title}”. Check the itinerary for the new order.`,
          tripId: input.tripId,
        });
        return { ok: true as const, applied: "swap" as const, moved: a.length + b.length };
      }

      if (input.kind === "flexible") {
        await db
          .update(schema.tripDays)
          .set({ flexible: true })
          .where(eq(schema.tripDays.id, input.dayId));
        await notify(ctx.user.id, {
          kind: "weather",
          title: "Day marked flexible",
          body: `A day on “${trip.title}” is now flexible, decide on the morning of.`,
          tripId: input.tripId,
        });
        return { ok: true as const, applied: "flexible" as const };
      }

      // indoor: replace an outdoor stop with an indoor alternative.
      if (!input.stopId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "stopId is required for indoor" });
      }
      const [stop] = await db
        .select()
        .from(schema.stops)
        .where(eq(schema.stops.id, input.stopId))
        .limit(1);
      if (!stop || stop.tripId !== input.tripId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found" });
      }
      const city = trip.destination.split(",")[0]?.trim() ?? trip.destination;
      const places = await db
        .select()
        .from(schema.explorePlaces)
        .where(eq(schema.explorePlaces.city, city));
      const indoor = places
        .filter((p) => {
          if (p.category !== "activity" || p.approved === false) return false;
          const tags = (p.tags ?? []).map((t) => t.toLowerCase());
          return tags.some((t) => INDOOR_TAGS.has(t));
        })
        // Prefer highly rated indoor places the trip doesn't already have.
        .filter((p) => p.name.toLowerCase() !== stop.name.toLowerCase())
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
      if (!indoor) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No indoor alternative found for this city yet",
        });
      }
      await db
        .update(schema.stops)
        .set({
          name: indoor.name,
          lat: indoor.lat ?? stop.lat,
          lng: indoor.lng ?? stop.lng,
          address: indoor.name,
          notes: `Indoor alternative for ${stop.name} (weather adaptation)`,
        })
        .where(eq(schema.stops.id, stop.id));
      await notify(ctx.user.id, {
        kind: "weather",
        title: "Swapped in an indoor alternative",
        body: `${stop.name} was replaced with ${indoor.name} on “${trip.title}” because of the weather.`,
        tripId: input.tripId,
      });
      return { ok: true as const, applied: "indoor" as const, replacement: indoor.name };
    }),
});

/** Tags in the explore corpus that mark a place as indoors. */
const INDOOR_TAGS = new Set([
  "museum",
  "gallery",
  "aquarium",
  "indoor",
  "mall",
  "shopping",
  "spa",
  "theater",
  "theatre",
  "cinema",
  "library",
]);
