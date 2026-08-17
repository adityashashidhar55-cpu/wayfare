/**
 * smart-cron.ts (r24-smart) - boot-time interval checks, production-guarded
 * and unref'd exactly like the explore feed prewarm in boot.ts. Every 6h:
 *
 *  K: trips starting within 16 days get a forecast scan; days crossing the
 *     analyzer thresholds post a "review adaptations" notification (once per
 *     trip+day+flag).
 *  O: wishlisted destinations whose best month starts within 2 months post a
 *     "now is a great time to plan" notification (once per wishlist entry).
 *
 * Everything is best-effort: a failing check logs and yields, never crashes
 * the server.
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { forecastForDates, daysAheadOf } from "./forecast";
import { analyzeForecast, flagsFor, type ForecastDay } from "./weather-advice";
import { geocodeCity } from "../queries/overpass";
import { notifyOnce } from "./notify";
import { bestTimeFor } from "./best-time";
import { todayIn } from "./tz";

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Cron runs server-side with no user in scope, so it uses the app default
 *  zone (APP_DEFAULT_TZ, Asia/Kolkata) rather than raw UTC. */
function todayISO(): string {
  return todayIn(null);
}

/** Weather threshold scan for trips starting inside the forecast horizon. */
export async function checkWeatherThresholds(): Promise<number> {
  const db = getDb();
  const today = todayISO();
  const horizon = new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10);
  const trips = await db
    .select()
    .from(schema.trips)
    .where(sql`${schema.trips.startDate} <= ${horizon} AND ${schema.trips.endDate} >= ${today}`);
  let sent = 0;
  for (const trip of trips) {
    try {
      const days = await db
        .select()
        .from(schema.tripDays)
        .where(eq(schema.tripDays.tripId, trip.id));
      const upcoming = days
        .filter((d) => d.date >= today && daysAheadOf(d.date) <= 15)
        .sort((a, b) => a.position - b.position);
      if (!upcoming.length) continue;

      let location: { lat: number; lng: number } | null = null;
      const geoStops = (
        await db
          .select({ lat: schema.stops.lat, lng: schema.stops.lng })
          .from(schema.stops)
          .where(eq(schema.stops.tripId, trip.id))
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
          // skip this trip
        }
      }
      if (!location) continue;

      const points = await forecastForDates(location.lat, location.lng, upcoming.map((d) => d.date));
      const byDate = new Map(points.map((p) => [p.date, p]));
      const analyzerInput: ForecastDay[] = upcoming.map((d) => {
        const p = byDate.get(d.date);
        return {
          dayId: d.id,
          date: d.date,
          tmaxC: p?.tmaxC ?? null,
          precipProbPct: p?.precipProbPct ?? null,
          approximate: p?.approximate ?? false,
          outdoorCount: 0,
        };
      });
      analyzeForecast(analyzerInput); // keeps threshold logic in one place
      for (const d of analyzerInput) {
        const flags = flagsFor(d);
        if (!flags.length) continue;
        const dayNo = upcoming.findIndex((x) => x.id === d.dayId) + 1;
        const flag = flags[0]!;
        const label = flag === "rainy" ? "Rain" : flag === "hot" ? "Heat" : "Cold";
        const created = await notifyOnce(trip.ownerId, {
          kind: "weather",
          title: `${label} expected Day ${dayNo} - review adaptations?`,
          body: `“${trip.title}”: ${d.date} looks ${flag === "rainy" ? "wet" : flag === "hot" ? "very hot" : "cold"}. Open the trip's weather advisory to review one-tap adaptations.`,
          tripId: trip.id,
        });
        if (created) sent++;
      }
    } catch (e) {
      console.warn("smart-cron: weather check failed for trip", trip.id, e);
    }
  }
  return sent;
}

/** Wishlist highlight scan: best month starts within 2 months. */
export async function checkWishlistHighlights(): Promise<number> {
  const db = getDb();
  const items = await db.select().from(schema.wishlistTrips);
  const nowMonth = new Date().getUTCMonth() + 1;
  const soon = new Set([0, 1, 2].map((k) => ((nowMonth - 1 + k) % 12) + 1));
  let sent = 0;
  for (const item of items) {
    try {
      const best = bestTimeFor(item.destination);
      const hit = best.top.find((m) => soon.has(m.month));
      if (!hit) continue;
      const created = await notifyOnce(item.userId, {
        kind: "wishlist",
        title: `Now is a great time to plan ${item.title}`,
        body: `${hit.name} is one of the best months for ${item.destination} (${hit.reasons[0] ?? "great conditions"}). Time to turn the wishlist into a trip.`,
      });
      if (created) sent++;
    } catch (e) {
      console.warn("smart-cron: wishlist check failed for", item.id, e);
    }
  }
  return sent;
}

export async function runSmartChecks(): Promise<void> {
  const w = await checkWeatherThresholds();
  const wl = await checkWishlistHighlights();
  if (w + wl > 0) console.log(`smart-cron: posted ${w} weather + ${wl} wishlist notification(s)`);
}

/** Start the 6h interval (unref'd so it never holds the process open). */
export function startSmartChecks(): void {
  const t = setInterval(() => {
    runSmartChecks().catch((e) => console.warn("smart-cron failed", e));
  }, SIX_HOURS);
  t.unref();
  // First pass shortly after boot, once caches and DB are warm.
  const kick = setTimeout(() => {
    runSmartChecks().catch((e) => console.warn("smart-cron failed", e));
  }, 60_000);
  kick.unref();
}
