import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TIERS } from "@contracts/premium";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { getTier } from "./queries/subscriptions";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import { resolveTz, todayIn } from "./lib/tz";

/**
 * Ready-made plan templates (trip_templates) - curated trips users clone into
 * their account with one click. `list`/`get` power the gallery + preview modal;
 * `clone` materializes a template into a real trip with the exact same
 * trip/days/stops structures the generators produce (SLOT_TIMES cadence,
 * day dates from a chosen start date).
 */

// Same cadence as the AI generator (trip-router SLOT_TIMES/SLOT_DURATIONS).
const SLOT_TIMES = ["09:00", "12:30", "15:00", "19:00", "21:15"];
const SLOT_DURATIONS = [150, 90, 120, 100, 90];
const PRESENCE_COLORS = ["#BC5934", "#44604F", "#6E7FA3", "#A86B8C", "#B98A2E", "#6E9A8B"];

// ── payloadJson shapes (written by db/seed-templates.ts) ─────────────────────
export type TemplateStopPayload = {
  name: string;
  category: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  durationMin: number | null;
  description: string | null;
  image: string | null;
};
export type TemplateDayPayload = {
  /** Short theme for the day, e.g. "Arashiyama & the west". */
  label: string | null;
  stops: TemplateStopPayload[];
};
export type TemplatePayload = {
  tags: string[];
  days: TemplateDayPayload[];
};

function parsePayload(raw: unknown): TemplatePayload {
  const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as TemplatePayload;
  if (!p || !Array.isArray(p.days)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "TEMPLATE_PAYLOAD_INVALID" });
  }
  return p;
}

/** UTC date list starting at `start`, `count` entries (YYYY-MM-DD). */
function datesFrom(start: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const templatesRouter = createRouter({
  /** Gallery cards: cover, day count, popularity - most-cloned first. */
  list: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: schema.tripTemplates.id,
        slug: schema.tripTemplates.slug,
        title: schema.tripTemplates.title,
        destination: schema.tripTemplates.destination,
        country: schema.tripTemplates.country,
        days: schema.tripTemplates.days,
        summary: schema.tripTemplates.summary,
        coverImage: schema.tripTemplates.coverImage,
        popularity: schema.tripTemplates.popularity,
      })
      .from(schema.tripTemplates)
      .orderBy(desc(schema.tripTemplates.popularity), desc(schema.tripTemplates.id));
    return { templates: rows };
  }),

  /** Full payload for the preview modal (day-by-day stops). */
  get: publicQuery
    .input(z.object({ slug: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.tripTemplates)
        .where(eq(schema.tripTemplates.slug, input.slug))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "TEMPLATE_UNKNOWN" });
      return { template: { ...row, payload: parsePayload(row.payloadJson) } };
    }),

  /**
   * Clone a template into the signed-in (or guest) user's account: creates the
   * trip, per-day rows dated from `startDate`, and stops on the standard
   * 09:00/12:30/15:00/19:00 cadence. Roadtrip-tagged templates produce
   * tripType='roadtrip' trips with car transport days. Bumps popularity.
   */
  clone: authedQuery
    .input(
      z.object({
        slug: z.string().min(1).max(64),
        startDate: z.string().regex(DATE_RE),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.tripTemplates)
        .where(eq(schema.tripTemplates.slug, input.slug))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "TEMPLATE_UNKNOWN" });
      const payload = parsePayload(row.payloadJson);
      const dayCount = payload.days.length || row.days;
      if (!dayCount) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "TEMPLATE_PAYLOAD_INVALID" });
      }

      // Same active-trip cap as trips.create (Free: 3 active trips).
      const tier = await getTier(ctx.user.id);
      const owned = await db.select().from(schema.trips).where(eq(schema.trips.ownerId, ctx.user.id));
      const activeCount = owned.filter(
        (t) => t.endDate >= todayIn(resolveTz(t.timezone, ctx.user.timezone)),
      ).length;
      if (activeCount >= TIERS[tier].maxTrips) {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }

      const isRoadtrip = (payload.tags ?? []).includes("roadtrip");
      const dates = datesFrom(input.startDate, dayCount);
      const endDate = dates[dates.length - 1]!;
      const destination = row.country ? `${row.destination}, ${row.country}` : row.destination;

      // Home currency from the taste profile when set (matches create modal).
      const prefRows = await db
        .select()
        .from(schema.preferences)
        .where(eq(schema.preferences.userId, ctx.user.id))
        .limit(1);
      const homeCurrency = prefRows[0]?.homeCurrency ?? "USD";

      const tripRes = await db.insert(schema.trips).values({
        ownerId: ctx.user.id,
        title: row.title,
        destination,
        coverImage: row.coverImage,
        startDate: input.startDate,
        endDate,
        homeCurrency,
        tripType: isRoadtrip ? "roadtrip" : "city",
      });
      const tripId = Number(tripRes[0].insertId);
      await db.insert(schema.tripMembers).values({
        tripId,
        userId: ctx.user.id,
        name: ctx.user.name ?? "You",
        email: ctx.user.email ?? null,
        role: "owner",
        presenceColor: PRESENCE_COLORS[0],
      });

      let stopsCreated = 0;
      let position = 0;
      for (let d = 0; d < dayCount; d++) {
        const dayRes = await db.insert(schema.tripDays).values({
          tripId,
          date: dates[d]!,
          position: d,
          transportMode: isRoadtrip ? "car" : "walk",
        });
        const dayId = Number(dayRes[0].insertId);
        const stops = payload.days[d]?.stops ?? [];
        for (let s = 0; s < stops.length; s++) {
          const stop = stops[s]!;
          await db.insert(schema.stops).values({
            tripId,
            dayId,
            name: stop.name,
            category: stop.category ?? "activity",
            address: stop.address,
            lat: stop.lat,
            lng: stop.lng,
            startTime: SLOT_TIMES[s] ?? "21:15",
            durationMin: stop.durationMin ?? SLOT_DURATIONS[s] ?? 90,
            notes: stop.description,
            image: stop.image,
            position: position++,
          });
          stopsCreated++;
        }
      }

      await db
        .update(schema.tripTemplates)
        .set({ popularity: sql`${schema.tripTemplates.popularity} + 1` })
        .where(eq(schema.tripTemplates.id, row.id));

      return { tripId, days: dayCount, stopsCreated };
    }),
});
