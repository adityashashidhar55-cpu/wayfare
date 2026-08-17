/**
 * Published trips (r24-social, feature P): explicit opt-in public pages.
 *
 *   publish.getForTrip      - member-facing publish state for the Share dialog
 *   publish.publish         - owner mints a slug; /p/:slug goes live
 *   publish.unpublish       - owner takes it down; the slug 404s immediately
 *   publish.setOpen         - owner toggles "accepting join requests"
 *   publish.getBySlug       - PUBLIC read-only page payload (itinerary days +
 *                             stops, updates feed, owner name; no emails/ids)
 *   publish.discover        - PUBLIC latest open trips for the Discover strip
 *   publish.requestJoin     - authed visitor asks to join (guards below)
 *   publish.listRequests    - owner inbox of join requests
 *   publish.respondRequest  - owner accepts (-> trip_members editor) or declines
 *   publish.postUpdate      - owner posts a note/milestone to the feed
 *
 * markStopBooked in trip-router calls autoPostBookingUpdate so booking
 * progress lands on the feed without the owner doing anything.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import { requireMembership } from "./trip-router";

const MAX_SUMMARY = 2000;
const MAX_UPDATE = 2000;
const MAX_REQUEST_MSG = 500;
const PRESENCE_COLORS = ["#BC5934", "#44604F", "#6E7FA3", "#A86B8C", "#B98A2E", "#6E9A8B"];

// ─── Pure helpers (exported for tests) ─────────────────────────────────────

/** Lowercase url-safe base from a title; "" when nothing usable remains. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
}

/** 4-char url-safe random suffix so two trips titled alike never collide. */
export function slugSuffix(rand: () => number = Math.random): string {
  const n = Math.floor(rand() * 36 ** 4);
  return n.toString(36).padStart(4, "0");
}

/** Final slug: "<base>-<suffix>", falling back to "trip" for empty bases. */
export function makePublishSlug(title: string, rand: () => number = Math.random): string {
  return `${slugifyTitle(title) || "trip"}-${slugSuffix(rand)}`;
}

export type JoinGuardInput = {
  isOpen: boolean;
  isOwner: boolean;
  isMember: boolean;
  existingStatus: "pending" | "accepted" | "declined" | null;
};

/** Join-request guard: an error message, or null when the request is allowed. */
export function joinRequestError(g: JoinGuardInput): string | null {
  if (g.isOwner) return "You own this trip";
  if (g.isMember) return "You're already on this trip";
  if (!g.isOpen) return "This trip isn't accepting join requests right now";
  if (g.existingStatus === "pending") return "Your request is already waiting for the organizer";
  if (g.existingStatus === "accepted") return "Your request was already accepted";
  return null; // a declined request may be re-sent
}

/** Update body validation (trimmed, 1..MAX_UPDATE). */
export function updateBodyError(body: string): string | null {
  const t = body.trim();
  if (!t) return "Update can't be empty";
  if (t.length > MAX_UPDATE) return `Keep updates under ${MAX_UPDATE} characters`;
  return null;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function publishedBySlug(slug: string) {
  const db = getDb();
  const [pub] = await db
    .select()
    .from(schema.publishedTrips)
    .where(eq(schema.publishedTrips.slug, slug))
    .limit(1);
  if (!pub) throw new TRPCError({ code: "NOT_FOUND", message: "This page isn't published" });
  return { db, pub };
}

/**
 * Auto-post a booking update when a stop on a published trip is marked
 * booked. Called from trip-router.markStopBooked; never throws (booking the
 * stop itself already succeeded).
 */
export async function autoPostBookingUpdate(
  tripId: number,
  authorName: string,
  stopName: string,
  booked: boolean,
): Promise<void> {
  try {
    const db = getDb();
    const [pub] = await db
      .select()
      .from(schema.publishedTrips)
      .where(eq(schema.publishedTrips.tripId, tripId))
      .limit(1);
    if (!pub) return;
    const body = booked
      ? `${authorName} booked ${stopName}`
      : `${authorName} unmarked ${stopName} as booked`;
    await db.insert(schema.tripUpdates).values({
      publishedId: pub.id,
      authorId: null,
      body: body.slice(0, 500),
      kind: "booking",
    });
  } catch (e) {
    console.warn("autoPostBookingUpdate failed:", e);
  }
}

async function ownerOf(pub: { ownerId: number }) {
  const db = getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, pub.ownerId)).limit(1);
  return u ?? null;
}

export const publishRouter = createRouter({
  /** Publish state for the workspace Share dialog (any trip member). */
  getForTrip: authedQuery
    .input(z.object({ tripId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [pub] = await db
        .select()
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.tripId, input.tripId))
        .limit(1);
      if (!pub) return { published: false as const };
      const pending = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.tripJoinRequests)
        .where(
          and(
            eq(schema.tripJoinRequests.publishedId, pub.id),
            eq(schema.tripJoinRequests.status, "pending"),
          ),
        );
      return {
        published: true as const,
        slug: pub.slug,
        title: pub.title,
        summary: pub.summary,
        isOpen: pub.isOpen,
        isOwner: pub.ownerId === ctx.user.id,
        pendingRequests: pending[0]?.n ?? 0,
      };
    }),

  /** Owner publishes the trip (explicit opt-in). Idempotent per trip. */
  publish: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        title: z.string().trim().min(1).max(255).optional(),
        summary: z.string().trim().max(MAX_SUMMARY).optional(),
        isOpen: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMembership(input.tripId, ctx.user.id);
      if (member.role !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the trip owner can publish" });
      }
      const db = getDb();
      const [existing] = await db
        .select()
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.tripId, input.tripId))
        .limit(1);
      if (existing) {
        await db
          .update(schema.publishedTrips)
          .set({
            ...(input.title ? { title: input.title } : {}),
            ...(input.summary !== undefined ? { summary: input.summary || null } : {}),
            isOpen: input.isOpen,
          })
          .where(eq(schema.publishedTrips.id, existing.id));
        return { slug: existing.slug, already: true };
      }
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
      const title = input.title ?? trip.title;
      // Retry the rare slug collision with a fresh suffix.
      let slug = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        slug = makePublishSlug(title);
        const [dupe] = await db
          .select({ id: schema.publishedTrips.id })
          .from(schema.publishedTrips)
          .where(eq(schema.publishedTrips.slug, slug))
          .limit(1);
        if (!dupe) break;
        if (attempt === 4) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not mint a link, try again" });
      }
      await db.insert(schema.publishedTrips).values({
        tripId: input.tripId,
        ownerId: ctx.user.id,
        slug,
        title: title.slice(0, 255),
        summary: input.summary?.trim() || null,
        isOpen: input.isOpen,
      });
      await db.insert(schema.tripUpdates).values({
        publishedId: (
          await db
            .select({ id: schema.publishedTrips.id })
            .from(schema.publishedTrips)
            .where(eq(schema.publishedTrips.slug, slug))
            .limit(1)
        )[0]!.id,
        authorId: null,
        body: `${ctx.user.name ?? "The organizer"} published this trip`,
        kind: "milestone",
      });
      // r24-smart Q: +30 tokens for publishing (once per trip).
      {
        const { awardTokens } = await import("./lib/tokens");
        await awardTokens(ctx.user.id, "trip_published", `publish:${input.tripId}`, { slug });
      }
      return { slug, already: false };
    }),

  /** Owner takes the page down; the slug immediately 404s. */
  unpublish: authedQuery
    .input(z.object({ tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [pub] = await db
        .select()
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.tripId, input.tripId))
        .limit(1);
      if (!pub) return { ok: true };
      if (pub.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the trip owner can unpublish" });
      }
      await db.delete(schema.tripUpdates).where(eq(schema.tripUpdates.publishedId, pub.id));
      await db.delete(schema.tripJoinRequests).where(eq(schema.tripJoinRequests.publishedId, pub.id));
      await db.delete(schema.publishedTrips).where(eq(schema.publishedTrips.id, pub.id));
      return { ok: true };
    }),

  /** Owner toggles whether the page accepts join requests. */
  setOpen: authedQuery
    .input(z.object({ tripId: z.number(), isOpen: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [pub] = await db
        .select()
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.tripId, input.tripId))
        .limit(1);
      if (!pub) throw new TRPCError({ code: "NOT_FOUND", message: "Trip is not published" });
      if (pub.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the trip owner can change this" });
      }
      await db.update(schema.publishedTrips).set({ isOpen: input.isOpen }).where(eq(schema.publishedTrips.id, pub.id));
      return { ok: true };
    }),

  /**
   * PUBLIC page payload: trip skeleton (title, destination, dates), itinerary
   * days + stops (no notes/internal ids beyond what's needed to render), the
   * updates feed, and the viewer's own join-request state when signed in.
   */
  getBySlug: publicQuery
    .input(z.object({ slug: z.string().min(4).max(80) }))
    .query(async ({ ctx, input }) => {
      const { db, pub } = await publishedBySlug(input.slug);
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, pub.tripId)).limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "This page isn't published" });
      const days = await db
        .select()
        .from(schema.tripDays)
        .where(eq(schema.tripDays.tripId, trip.id))
        .orderBy(schema.tripDays.position);
      const stops = await db
        .select({
          id: schema.stops.id,
          dayId: schema.stops.dayId,
          name: schema.stops.name,
          category: schema.stops.category,
          address: schema.stops.address,
          lat: schema.stops.lat,
          lng: schema.stops.lng,
          startTime: schema.stops.startTime,
          durationMin: schema.stops.durationMin,
          image: schema.stops.image,
          bookedAt: schema.stops.bookedAt,
          position: schema.stops.position,
        })
        .from(schema.stops)
        .where(eq(schema.stops.tripId, trip.id))
        .orderBy(schema.stops.position);
      const updates = await db
        .select()
        .from(schema.tripUpdates)
        .where(eq(schema.tripUpdates.publishedId, pub.id))
        .orderBy(desc(schema.tripUpdates.id))
        .limit(50);
      const owner = await ownerOf(pub);

      let viewer: { isOwner: boolean; isMember: boolean; requestStatus: string | null } = {
        isOwner: false,
        isMember: false,
        requestStatus: null,
      };
      if (ctx.user) {
        const [membership] = await db
          .select()
          .from(schema.tripMembers)
          .where(and(eq(schema.tripMembers.tripId, trip.id), eq(schema.tripMembers.userId, ctx.user.id)))
          .limit(1);
        const [req] = await db
          .select()
          .from(schema.tripJoinRequests)
          .where(
            and(eq(schema.tripJoinRequests.publishedId, pub.id), eq(schema.tripJoinRequests.userId, ctx.user.id)),
          )
          .limit(1);
        viewer = {
          isOwner: pub.ownerId === ctx.user.id,
          isMember: membership != null,
          requestStatus: req?.status ?? null,
        };
      }

      const authorNames = new Map<number, string>();
      const authorIds = [...new Set(updates.map((u) => u.authorId).filter((x): x is number => x != null))];
      if (authorIds.length) {
        const users = await db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(inArray(schema.users.id, authorIds));
        for (const u of users) authorNames.set(u.id, u.name ?? "Organizer");
      }

      return {
        slug: pub.slug,
        title: pub.title,
        summary: pub.summary,
        isOpen: pub.isOpen,
        createdAt: pub.createdAt,
        ownerName: owner?.name ?? "A Wayfare traveler",
        trip: {
          destination: trip.destination,
          startDate: trip.startDate,
          endDate: trip.endDate,
          coverImage: trip.coverImage,
        },
        days: days.map((d) => ({ id: d.id, date: d.date })),
        stops,
        updates: updates.map((u) => ({
          id: u.id,
          body: u.body,
          kind: u.kind,
          createdAt: u.createdAt,
          authorName: u.authorId != null ? (authorNames.get(u.authorId) ?? "Organizer") : null,
        })),
        viewer,
        signedIn: ctx.user != null,
        // internal trip id, only for the owner's console calls
        ...(viewer.isOwner ? { ownerTripId: trip.id } : {}),
      };
    }),

  /** PUBLIC discover strip: latest open published trips. */
  discover: publicQuery
    .input(z.object({ limit: z.number().int().min(1).max(24).default(8) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: schema.publishedTrips.id,
          slug: schema.publishedTrips.slug,
          title: schema.publishedTrips.title,
          summary: schema.publishedTrips.summary,
          createdAt: schema.publishedTrips.createdAt,
          ownerId: schema.publishedTrips.ownerId,
          destination: schema.trips.destination,
          startDate: schema.trips.startDate,
          endDate: schema.trips.endDate,
          coverImage: schema.trips.coverImage,
        })
        .from(schema.publishedTrips)
        .innerJoin(schema.trips, eq(schema.trips.id, schema.publishedTrips.tripId))
        .where(eq(schema.publishedTrips.isOpen, true))
        .orderBy(desc(schema.publishedTrips.id))
        .limit(input?.limit ?? 8);
      const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
      const names = new Map<number, string>();
      if (ownerIds.length) {
        const users = await db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(inArray(schema.users.id, ownerIds));
        for (const u of users) names.set(u.id, u.name ?? "A Wayfare traveler");
      }
      return {
        trips: rows.map((r) => ({
          slug: r.slug,
          title: r.title,
          summary: r.summary,
          destination: r.destination,
          startDate: r.startDate,
          endDate: r.endDate,
          coverImage: r.coverImage,
          ownerName: names.get(r.ownerId) ?? "A Wayfare traveler",
        })),
      };
    }),

  /** Authed visitor asks to join; guards keep the inbox clean. */
  requestJoin: authedQuery
    .input(
      z.object({
        slug: z.string().min(4).max(80),
        message: z.string().trim().max(MAX_REQUEST_MSG).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, pub } = await publishedBySlug(input.slug);
      const [membership] = await db
        .select()
        .from(schema.tripMembers)
        .where(and(eq(schema.tripMembers.tripId, pub.tripId), eq(schema.tripMembers.userId, ctx.user.id)))
        .limit(1);
      const [existing] = await db
        .select()
        .from(schema.tripJoinRequests)
        .where(and(eq(schema.tripJoinRequests.publishedId, pub.id), eq(schema.tripJoinRequests.userId, ctx.user.id)))
        .limit(1);
      const err = joinRequestError({
        isOpen: pub.isOpen,
        isOwner: pub.ownerId === ctx.user.id,
        isMember: membership != null,
        existingStatus: (existing?.status as "pending" | "accepted" | "declined") ?? null,
      });
      if (err) throw new TRPCError({ code: "BAD_REQUEST", message: err });
      if (existing) {
        // re-request after a decline: back to pending with the new message
        await db
          .update(schema.tripJoinRequests)
          .set({ status: "pending", message: input.message?.trim() || null })
          .where(eq(schema.tripJoinRequests.id, existing.id));
        return { ok: true, status: "pending" as const };
      }
      await db.insert(schema.tripJoinRequests).values({
        publishedId: pub.id,
        userId: ctx.user.id,
        message: input.message?.trim() || null,
        status: "pending",
      });
      return { ok: true, status: "pending" as const };
    }),

  /** Owner inbox: all requests for their published trip, newest first. */
  listRequests: authedQuery
    .input(z.object({ tripId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [pub] = await db
        .select()
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.tripId, input.tripId))
        .limit(1);
      if (!pub) throw new TRPCError({ code: "NOT_FOUND", message: "Trip is not published" });
      if (pub.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the trip owner can see requests" });
      }
      const rows = await db
        .select()
        .from(schema.tripJoinRequests)
        .where(eq(schema.tripJoinRequests.publishedId, pub.id))
        .orderBy(desc(schema.tripJoinRequests.id))
        .limit(100);
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const usersById = new Map<number, { name: string | null; email: string | null }>();
      if (userIds.length) {
        const users = await db
          .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds));
        for (const u of users) usersById.set(u.id, { name: u.name, email: u.email });
      }
      return {
        slug: pub.slug,
        requests: rows.map((r) => ({
          id: r.id,
          name: usersById.get(r.userId)?.name ?? "Wayfare user",
          email: usersById.get(r.userId)?.email ?? null,
          message: r.message,
          status: r.status,
          createdAt: r.createdAt,
        })),
      };
    }),

  /** Owner accepts (member added as editor) or declines a join request. */
  respondRequest: authedQuery
    .input(
      z.object({
        requestId: z.number(),
        accept: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [req] = await db
        .select()
        .from(schema.tripJoinRequests)
        .where(eq(schema.tripJoinRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      const [pub] = await db
        .select()
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.id, req.publishedId))
        .limit(1);
      if (!pub) throw new TRPCError({ code: "NOT_FOUND", message: "Trip is not published" });
      if (pub.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the trip owner can respond" });
      }
      if (req.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This request was already handled" });
      }
      await db
        .update(schema.tripJoinRequests)
        .set({ status: input.accept ? "accepted" : "declined" })
        .where(eq(schema.tripJoinRequests.id, req.id));
      if (input.accept) {
        const [requester] = await db.select().from(schema.users).where(eq(schema.users.id, req.userId)).limit(1);
        const members = await db
          .select()
          .from(schema.tripMembers)
          .where(eq(schema.tripMembers.tripId, pub.tripId));
        if (!members.some((m) => m.userId === req.userId)) {
          await db.insert(schema.tripMembers).values({
            tripId: pub.tripId,
            userId: req.userId,
            name: requester?.name ?? "Traveler",
            email: requester?.email ?? null,
            role: "editor",
            presenceColor: PRESENCE_COLORS[members.length % PRESENCE_COLORS.length],
          });
        }
        await db.insert(schema.tripUpdates).values({
          publishedId: pub.id,
          authorId: null,
          body: `${requester?.name ?? "A traveler"} joined the trip`,
          kind: "milestone",
        });
        // r24-smart Q: +15 tokens to the traveler whose join request was
        // accepted (once per request) + a bell notification.
        const { awardTokens } = await import("./lib/tokens");
        await awardTokens(req.userId, "join_accepted", `join:${req.id}`, { tripId: pub.tripId });
        const { notify } = await import("./lib/notify");
        await notify(req.userId, {
          kind: "travel",
          title: "Join request accepted",
          body: `You're in! “${pub.title}” added you as a tripmate, the trip is in your Trips list.`,
          tripId: pub.tripId,
        });
      }
      return { ok: true, status: input.accept ? ("accepted" as const) : ("declined" as const) };
    }),

  /** Owner posts a note/milestone to the public updates feed. */
  postUpdate: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        body: z.string().max(MAX_UPDATE * 2),
        kind: z.enum(["note", "milestone"]).default("note"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [pub] = await db
        .select()
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.tripId, input.tripId))
        .limit(1);
      if (!pub) throw new TRPCError({ code: "NOT_FOUND", message: "Trip is not published" });
      if (pub.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the trip owner can post updates" });
      }
      const err = updateBodyError(input.body);
      if (err) throw new TRPCError({ code: "BAD_REQUEST", message: err });
      const res = await db.insert(schema.tripUpdates).values({
        publishedId: pub.id,
        authorId: ctx.user.id,
        body: input.body.trim(),
        kind: input.kind,
      });
      return { ok: true, id: Number(res[0].insertId) };
    }),
});
