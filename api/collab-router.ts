/**
 * collab-router (r29) - the three group-planning features the product
 * advertised and did not have.
 *
 * 1. IN-TRIP CHAT. Chat existed but was bound to `friend_sessions`, the
 *    pre-trip availability flow. Converting a session to a trip left the
 *    conversation behind, and a trip created any other way had no chat at
 *    all. Groups moved to WhatsApp and stopped coming back.
 *
 * 2. VOTING ON STOPS. `FeatureTour` has marketed "Vote on stops together,
 *    decide in one place" since launch. No votes table existed. The only
 *    voting in the product was pre-trip date availability.
 *
 * 3. PRIVATE CHECKLIST ITEMS. Every checklist row was trip-wide, so there was
 *    no way to keep "pack my inhaler" off the group packing list.
 *
 * Permissions throughout use requireMembership for reading and taking part,
 * and requireEditor for changing the itinerary. Note that the pre-existing
 * checklist procedures in trip-router use requireMembership even for writes,
 * which lets a VIEWER edit the group list; that is fixed here for the
 * ownership-aware paths.
 */
import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { requireEditor, requireMembership } from "./trip-router";

/** Chat page size. The client polls for anything after a watermark id. */
const MESSAGE_PAGE = 50;

/** Assert a stop belongs to this trip before anything is written against it. */
async function assertStopInTrip(stopId: number, tripId: number): Promise<void> {
  const [row] = await getDb()
    .select({ id: schema.stops.id })
    .from(schema.stops)
    .where(and(eq(schema.stops.id, stopId), eq(schema.stops.tripId, tripId)))
    .limit(1);
  if (!row) {
    // Stop ids are enumerable. Without this a member of trip A could vote on,
    // or comment against, a stop in trip B - the same class of hole the r25
    // audit found across ten trip-router procedures.
    throw new TRPCError({ code: "NOT_FOUND", message: "That stop is not on this trip" });
  }
}

export const collabRouter = createRouter({
  // ── Chat ────────────────────────────────────────────────────────────────
  messages: authedQuery
    .input(z.object({
      tripId: z.number(),
      /** Watermark: return only messages after this id. 0 = newest page. */
      afterId: z.number().int().nonnegative().default(0),
    }))
    .query(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.tripMessages)
        .where(
          input.afterId > 0
            ? and(eq(schema.tripMessages.tripId, input.tripId), gt(schema.tripMessages.id, input.afterId))
            : eq(schema.tripMessages.tripId, input.tripId),
        )
        .orderBy(input.afterId > 0 ? asc(schema.tripMessages.id) : desc(schema.tripMessages.id))
        .limit(MESSAGE_PAGE);
      // Newest-page reads come back descending for the LIMIT to mean "latest
      // 50"; the client always wants oldest-first.
      const ordered = input.afterId > 0 ? rows : [...rows].reverse();
      return { messages: ordered, latestId: ordered.length ? Number(ordered[ordered.length - 1]!.id) : input.afterId };
    }),

  sendMessage: authedQuery
    .input(z.object({
      tripId: z.number(),
      body: z.string().trim().min(1).max(2000),
      stopId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      if (input.stopId != null) await assertStopInTrip(input.stopId, input.tripId);
      const db = getDb();
      const result = await db.insert(schema.tripMessages).values({
        tripId: input.tripId,
        userId: ctx.user.id,
        // Denormalised so the message keeps its author name even if the
        // member is later removed from the trip.
        authorName: ctx.user.name ?? "Someone",
        body: input.body,
        stopId: input.stopId ?? null,
      });
      return { id: Number(result[0].insertId) };
    }),

  // ── Voting ──────────────────────────────────────────────────────────────
  /**
   * Cast or change a vote. Idempotent by (stopId, userId): voting the same
   * way twice is a no-op, voting the other way is a correction, and voting
   * the same way you already did CLEARS it (click to un-vote).
   */
  voteStop: authedQuery
    .input(z.object({
      tripId: z.number(),
      stopId: z.number(),
      vote: z.enum(["up", "down"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      await assertStopInTrip(input.stopId, input.tripId);
      const db = getDb();
      const [existing] = await db
        .select()
        .from(schema.stopVotes)
        .where(and(eq(schema.stopVotes.stopId, input.stopId), eq(schema.stopVotes.userId, ctx.user.id)))
        .limit(1);

      if (existing && existing.vote === input.vote) {
        await db.delete(schema.stopVotes).where(eq(schema.stopVotes.id, existing.id));
        return { state: "cleared" as const };
      }
      if (existing) {
        await db.update(schema.stopVotes).set({ vote: input.vote }).where(eq(schema.stopVotes.id, existing.id));
        return { state: "changed" as const };
      }
      await db.insert(schema.stopVotes).values({
        tripId: input.tripId, stopId: input.stopId, userId: ctx.user.id, vote: input.vote,
      });
      return { state: "cast" as const };
    }),

  /** Tallies for every stop on a trip, plus what the caller voted. */
  votes: authedQuery
    .input(z.object({ tripId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const rows = await getDb()
        .select({
          stopId: schema.stopVotes.stopId,
          vote: schema.stopVotes.vote,
          userId: schema.stopVotes.userId,
        })
        .from(schema.stopVotes)
        .where(eq(schema.stopVotes.tripId, input.tripId));

      const tally = new Map<number, { up: number; down: number; mine: "up" | "down" | null }>();
      for (const r of rows) {
        const id = Number(r.stopId);
        const t = tally.get(id) ?? { up: 0, down: 0, mine: null };
        if (r.vote === "up") t.up++; else t.down++;
        if (Number(r.userId) === ctx.user.id) t.mine = r.vote;
        tally.set(id, t);
      }
      return {
        votes: [...tally.entries()].map(([stopId, t]) => ({ stopId, ...t, score: t.up - t.down })),
      };
    }),

  /**
   * Drop every stop the group voted down more than up.
   *
   * Editor-only: this changes the itinerary, unlike casting a vote which any
   * member may do. Returns what it removed so the UI can say so rather than
   * silently shrinking the plan.
   */
  applyVotes: authedQuery
    .input(z.object({ tripId: z.number(), minNetDown: z.number().int().min(1).default(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const rows = await db
        .select({ stopId: schema.stopVotes.stopId, vote: schema.stopVotes.vote })
        .from(schema.stopVotes)
        .where(eq(schema.stopVotes.tripId, input.tripId));
      const net = new Map<number, number>();
      for (const r of rows) {
        const id = Number(r.stopId);
        net.set(id, (net.get(id) ?? 0) + (r.vote === "up" ? 1 : -1));
      }
      const doomed = [...net.entries()].filter(([, n]) => n <= -input.minNetDown).map(([id]) => id);
      if (!doomed.length) return { removed: 0, names: [] as string[] };

      const names = await db
        .select({ name: schema.stops.name })
        .from(schema.stops)
        .where(and(eq(schema.stops.tripId, input.tripId), inArray(schema.stops.id, doomed)));
      await db.delete(schema.stops)
        .where(and(eq(schema.stops.tripId, input.tripId), inArray(schema.stops.id, doomed)));
      await db.delete(schema.stopVotes)
        .where(and(eq(schema.stopVotes.tripId, input.tripId), inArray(schema.stopVotes.stopId, doomed)));
      return { removed: doomed.length, names: names.map((n) => n.name) };
    }),

  // ── Checklists with ownership ───────────────────────────────────────────
  /**
   * Every item the caller is allowed to see: all shared items, plus their own
   * private ones. A private item belonging to someone else must never appear,
   * which is why this filters in SQL rather than trusting the client.
   */
  checklist: authedQuery
    .input(z.object({ tripId: z.number(), list: z.string().max(24).optional() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const ci = schema.checklistItems;
      const visible = or(
        eq(ci.visibility, "shared"),
        eq(ci.ownerId, ctx.user.id),
      )!;
      const rows = await getDb()
        .select()
        .from(ci)
        .where(and(
          eq(ci.tripId, input.tripId),
          input.list ? eq(ci.list, input.list) : undefined,
          visible,
        ))
        .orderBy(asc(ci.position), asc(ci.id));
      return {
        items: rows.map((r) => ({ ...r, isMine: Number(r.ownerId ?? 0) === ctx.user.id })),
      };
    }),

  addChecklistItem: authedQuery
    .input(z.object({
      tripId: z.number(),
      list: z.string().min(1).max(24),
      label: z.string().trim().min(1).max(255),
      visibility: z.enum(["shared", "private"]).default("shared"),
      assignedMemberId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // A viewer may keep their OWN private list on a trip they can see, but
      // may not add to the group's. The pre-existing trip-router checklist
      // procedures use requireMembership for writes, which lets a viewer edit
      // the shared list; this path draws the line properly.
      if (input.visibility === "shared") await requireEditor(input.tripId, ctx.user.id);
      else await requireMembership(input.tripId, ctx.user.id);

      const db = getDb();
      if (input.assignedMemberId != null) {
        const [m] = await db
          .select({ id: schema.tripMembers.id })
          .from(schema.tripMembers)
          .where(and(
            eq(schema.tripMembers.id, input.assignedMemberId),
            eq(schema.tripMembers.tripId, input.tripId),
          ))
          .limit(1);
        if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "That member is not on this trip" });
      }
      const [maxRow] = await db
        .select({ n: sql<number>`COALESCE(MAX(${schema.checklistItems.position}), -1)` })
        .from(schema.checklistItems)
        .where(and(eq(schema.checklistItems.tripId, input.tripId), eq(schema.checklistItems.list, input.list)));
      const result = await db.insert(schema.checklistItems).values({
        tripId: input.tripId,
        list: input.list,
        label: input.label,
        position: Number(maxRow?.n ?? -1) + 1,
        // A shared item has no owner - that is what makes it the group's.
        ownerId: input.visibility === "private" ? ctx.user.id : null,
        visibility: input.visibility,
        assignedMemberId: input.assignedMemberId ?? null,
      });
      return { id: Number(result[0].insertId) };
    }),

  /** Flip an item. A private item can only be flipped by its owner. */
  toggleChecklistItem: authedQuery
    .input(z.object({ tripId: z.number(), id: z.number(), done: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [item] = await db
        .select()
        .from(schema.checklistItems)
        .where(and(eq(schema.checklistItems.id, input.id), eq(schema.checklistItems.tripId, input.tripId)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found on this trip" });
      if (item.visibility === "private" && Number(item.ownerId) !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "That is someone else's private item" });
      }
      await db.update(schema.checklistItems)
        .set({ done: input.done })
        .where(and(eq(schema.checklistItems.id, input.id), eq(schema.checklistItems.tripId, input.tripId)));
      return { ok: true };
    }),

  /** Move an item between the group list and your own private one. */
  setChecklistVisibility: authedQuery
    .input(z.object({ tripId: z.number(), id: z.number(), visibility: z.enum(["shared", "private"]) }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [item] = await db
        .select()
        .from(schema.checklistItems)
        .where(and(eq(schema.checklistItems.id, input.id), eq(schema.checklistItems.tripId, input.tripId)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found on this trip" });
      // Only the owner may un-share their own item, and only an editor may
      // push something onto the group list.
      if (item.visibility === "private" && Number(item.ownerId) !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "That is someone else's private item" });
      }
      if (input.visibility === "shared") await requireEditor(input.tripId, ctx.user.id);
      await db.update(schema.checklistItems)
        .set({
          visibility: input.visibility,
          ownerId: input.visibility === "private" ? ctx.user.id : null,
        })
        .where(and(eq(schema.checklistItems.id, input.id), eq(schema.checklistItems.tripId, input.tripId)));
      return { ok: true };
    }),

  deleteChecklistItem: authedQuery
    .input(z.object({ tripId: z.number(), id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [item] = await db
        .select()
        .from(schema.checklistItems)
        .where(and(eq(schema.checklistItems.id, input.id), eq(schema.checklistItems.tripId, input.tripId)))
        .limit(1);
      if (!item) return { ok: true };
      if (item.visibility === "private") {
        if (Number(item.ownerId) !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "That is someone else's private item" });
        }
      } else {
        await requireEditor(input.tripId, ctx.user.id);
      }
      await db.delete(schema.checklistItems)
        .where(and(eq(schema.checklistItems.id, input.id), eq(schema.checklistItems.tripId, input.tripId)));
      return { ok: true };
    }),
});
