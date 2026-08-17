import { and, desc, eq, inArray, like, notLike, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { importCityPlaces } from "./queries/overpass";
import { adminQuery, createRouter } from "./middleware";

/**
 * Admin guard: authed + ctx.user.role === 'admin' (else FORBIDDEN).
 * `adminQuery` from middleware.ts already implements exactly this.
 */
const adminProcedure = adminQuery;

const GUEST_PATTERN = "guest-%";

const pageInput = {
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional(),
};

// ─── Places database console (nested admin.places.* router) ──────────────────

export const VERDICT_VALUES = ["must-see", "worth-it", "skip-if-tight"] as const;

/** Escape LIKE wildcards so a search term is matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export interface PlaceSearchFilters {
  q?: string;
  city?: string;
  country?: string;
  category?: string;
  verdict?: (typeof VERDICT_VALUES)[number];
  source?: "curated" | "osm" | "user";
}

/**
 * Smart-search WHERE conditions for the places consoles (admin + portal,
 * r19-portal): ONE free-text `q` fuzzy-matches name (and nameLocal, so a
 * translated place is findable by its original Arabic/CJK name too), city
 * and country; the dropdowns stay as exact refinements. Shared by
 * admin.places.search and portal.places.search so both search identically.
 */
export function placeSearchConditions(input: PlaceSearchFilters): SQL[] {
  const conditions: SQL[] = [];
  const q = input.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const match = or(
      like(schema.explorePlaces.name, pattern),
      like(schema.explorePlaces.nameLocal, pattern), // r19-portal
      like(schema.explorePlaces.city, pattern),
      like(schema.explorePlaces.country, pattern),
    );
    if (match) conditions.push(match);
  }
  const city = input.city?.trim();
  if (city) conditions.push(eq(schema.explorePlaces.city, city));
  const country = input.country?.trim();
  if (country) conditions.push(eq(schema.explorePlaces.country, country));
  const category = input.category?.trim();
  if (category) conditions.push(eq(schema.explorePlaces.category, category));
  if (input.verdict) conditions.push(eq(schema.explorePlaces.verdict, input.verdict));
  if (input.source) conditions.push(eq(schema.explorePlaces.source, input.source));
  return conditions;
}

const tagList = z.array(z.string().trim().min(1).max(64)).max(32);

/** Editable fields on an explore place. All optional - only provided keys are patched. */
export const placePatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(32).optional(),
  city: z.string().trim().min(1).max(255).optional(),
  country: z.string().trim().min(1).max(255).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  rating: z.number().min(0).max(5).optional(),
  verdict: z.enum(VERDICT_VALUES).nullable().optional(), // null clears the verdict
  tags: tagList.optional(),
  styles: tagList.optional(),
  image: z.string().trim().max(512).nullable().optional(), // null/"" clears the image
  photoAttribution: z.string().trim().max(255).nullable().optional(),
  description: z.string().max(10000).nullable().optional(), // null/"" clears the description
});
export type PlacePatchInput = z.infer<typeof placePatchSchema>;

/** Create fields - same editable set, with the location core required. */
export const placeCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  category: z.string().trim().min(1).max(32),
  city: z.string().trim().min(1).max(255),
  country: z.string().trim().min(1).max(255),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  rating: z.number().min(0).max(5).optional(),
  verdict: z.enum(VERDICT_VALUES).nullable().optional(),
  tags: tagList.optional(),
  styles: tagList.optional(),
  image: z.string().trim().max(512).nullable().optional(),
  photoAttribution: z.string().trim().max(255).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
});
export type PlaceCreateInput = z.infer<typeof placeCreateSchema>;

export const bulkDeleteByFilterSchema = z.object({
  city: z.string().trim().min(1).max(255).optional(),
  country: z.string().trim().min(1).max(255).optional(),
  /** Raw LIKE pattern matched against name, e.g. '%駐車場%' for parking lots. */
  nameLike: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(32).optional(),
  /** Typed-confirm gate - the caller must explicitly pass true. */
  confirm: z.literal(true),
});
export type BulkDeleteByFilterInput = z.infer<typeof bulkDeleteByFilterSchema>;

/** Map a validated patch to a Drizzle set-object, dropping undefined keys and normalizing "" → null. */
export function toPlacePatch(
  patch: PlacePatchInput,
): Partial<
  Pick<
    schema.ExplorePlace,
    | "name"
    | "category"
    | "city"
    | "country"
    | "lat"
    | "lng"
    | "rating"
    | "verdict"
    | "tags"
    | "styles"
    | "image"
    | "photoAttribution"
    | "description"
    | "descriptionSource"
  >
> {
  const out: ReturnType<typeof toPlacePatch> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.category !== undefined) out.category = patch.category;
  if (patch.city !== undefined) out.city = patch.city;
  if (patch.country !== undefined) out.country = patch.country;
  if (patch.lat !== undefined) out.lat = patch.lat;
  if (patch.lng !== undefined) out.lng = patch.lng;
  if (patch.rating !== undefined) out.rating = patch.rating;
  if (patch.verdict !== undefined) out.verdict = patch.verdict;
  if (patch.tags !== undefined) out.tags = patch.tags;
  if (patch.styles !== undefined) out.styles = patch.styles;
  if (patch.image !== undefined) out.image = patch.image?.trim() ? patch.image.trim() : null;
  if (patch.photoAttribution !== undefined) {
    out.photoAttribution = patch.photoAttribution?.trim() ? patch.photoAttribution.trim() : null;
  }
  if (patch.description !== undefined) {
    const text = patch.description?.trim() ?? "";
    out.description = text || null;
    // Hand-written portal text is owner-authored canon.
    out.descriptionSource = text ? "user" : null;
  }
  return out;
}

/** Filter conditions for bulk delete - every provided filter narrows the match set. */
export function bulkDeleteConditions(
  input: Omit<BulkDeleteByFilterInput, "confirm">,
): SQL[] {
  const conditions: SQL[] = [];
  if (input.city) conditions.push(eq(schema.explorePlaces.city, input.city));
  if (input.country) conditions.push(eq(schema.explorePlaces.country, input.country));
  if (input.category) conditions.push(eq(schema.explorePlaces.category, input.category));
  if (input.nameLike) conditions.push(like(schema.explorePlaces.name, input.nameLike));
  return conditions;
}

/** Safety rail: bulk-delete-by-filter must specify at least one narrowing filter. */
export function hasBulkCriteria(input: Omit<BulkDeleteByFilterInput, "confirm">): boolean {
  return Boolean(input.city || input.country || input.category || input.nameLike);
}

const affectedRows = (res: unknown) => Number((res as { affectedRows?: number }[])?.[0]?.affectedRows ?? 0);

/** Nested console router - mounted as admin.places.* */
const placesDbRouter = createRouter({
  /** Paginated corpus search with indexed filters. `cursor` = offset (infinite scroll), `page` = 1-based page. */
  search: adminProcedure
    .input(
      z.object({
        q: z.string().max(255).optional(),
        city: z.string().max(255).optional(),
        country: z.string().max(255).optional(),
        category: z.string().max(32).optional(),
        verdict: z.enum(VERDICT_VALUES).optional(),
        source: z.enum(["curated", "osm", "user"]).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
        cursor: z.number().int().min(0).optional(),
      }),
    )
    .query(async ({ input }) => {
      const pageSize = input.pageSize ?? 50;
      const page = input.page ?? 1;
      const offset = input.cursor ?? (page - 1) * pageSize;

      const conditions = placeSearchConditions(input);
      const where = conditions.length ? and(...conditions) : undefined;

      const db = getDb();
      const [totalRows, rows] = await Promise.all([
        db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces).where(where),
        db
          .select()
          .from(schema.explorePlaces)
          .where(where)
          .orderBy(desc(schema.explorePlaces.id))
          .limit(pageSize)
          .offset(offset),
      ]);
      const total = Number(totalRows[0]?.n ?? 0);
      return {
        places: rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        nextCursor: offset + rows.length < total ? offset + rows.length : undefined,
      };
    }),

  /** Full row for the edit form. */
  get: adminProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const [row] = await getDb()
      .select()
      .from(schema.explorePlaces)
      .where(eq(schema.explorePlaces.id, input.id))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
    return row;
  }),

  /** Patch the editable fields of a place. */
  update: adminProcedure
    .input(z.object({ id: z.number().int(), patch: placePatchSchema }))
    .mutation(async ({ input }) => {
      const patch = toPlacePatch(input.patch);
      const db = getDb();
      if (Object.keys(patch).length) {
        await db.update(schema.explorePlaces).set(patch).where(eq(schema.explorePlaces.id, input.id));
      }
      const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
      return row;
    }),

  /** Add a new curated place to the corpus. */
  create: adminProcedure.input(placeCreateSchema).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const values = {
      ...toPlacePatch(input),
      name: input.name,
      category: input.category,
      city: input.city,
      country: input.country,
      lat: input.lat,
      lng: input.lng,
      source: "curated",
      approved: true,
      addedById: ctx.user.id,
    };
    const res = await db.insert(schema.explorePlaces).values(values);
    const id = Number((res as unknown as [{ insertId?: number }])[0]?.insertId ?? 0);
    const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, id)).limit(1);
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert failed" });
    return row;
  }),

  delete: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const res = await getDb().delete(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.id));
    return { ok: true, deleted: affectedRows(res) };
  }),

  /** Delete a checked-off set of rows at once. */
  bulkDelete: adminProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1).max(500) }))
    .mutation(async ({ input }) => {
      const res = await getDb().delete(schema.explorePlaces).where(inArray(schema.explorePlaces.id, input.ids));
      return { ok: true, deleted: affectedRows(res) };
    }),

  /**
   * Danger-zone cleanup: delete every row matching ALL provided filters (ANDed).
   * Requires at least one filter and confirm: true - e.g. { nameLike: '%駐車場%', confirm: true }
   * wipes imported parking lots.
   */
  bulkDeleteByFilter: adminProcedure
    .input(bulkDeleteByFilterSchema)
    .mutation(async ({ input }) => {
      const { confirm: _confirm, ...filters } = input;
      if (!hasBulkCriteria(filters)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Provide at least one filter (city, country, nameLike, or category), refusing to delete everything",
        });
      }
      const conditions = bulkDeleteConditions(filters);
      const res = await getDb()
        .delete(schema.explorePlaces)
        .where(and(...conditions));
      return { ok: true, deleted: affectedRows(res) };
    }),

  /** Console header data: total + top categories / countries for filter dropdowns. */
  stats: adminProcedure.query(async () => {
    const db = getDb();
    const [totalRows, categoryRows, countryRows] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces),
      db
        .select({ category: schema.explorePlaces.category, n: sql<number>`count(*)` })
        .from(schema.explorePlaces)
        .groupBy(schema.explorePlaces.category)
        .orderBy(desc(sql`count(*)`))
        .limit(30),
      db
        .select({ country: schema.explorePlaces.country, n: sql<number>`count(*)` })
        .from(schema.explorePlaces)
        .groupBy(schema.explorePlaces.country)
        .orderBy(desc(sql`count(*)`))
        .limit(30),
    ]);
    return {
      total: Number(totalRows[0]?.n ?? 0),
      byCategory: categoryRows.map((r) => ({ category: r.category, count: Number(r.n) })),
      byCountry: countryRows.map((r) => ({ country: r.country, count: Number(r.n) })),
    };
  }),
});

export const adminRouter = createRouter({
  /** Platform-wide stats for the Overview bento. Single queries in parallel. */
  stats: adminProcedure.query(async () => {
    const db = getDb();
    const one = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0);
    const [
      users,
      guests,
      trips,
      stops,
      placesTotal,
      placesCurated,
      placesOsm,
      placesUser,
      posts,
      likesRows,
      expenses,
      reservations,
      pendingPlaces,
    ] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(schema.users).where(notLike(schema.users.unionId, GUEST_PATTERN)),
      db.select({ n: sql<number>`count(*)` }).from(schema.users).where(like(schema.users.unionId, GUEST_PATTERN)),
      db.select({ n: sql<number>`count(*)` }).from(schema.trips),
      db.select({ n: sql<number>`count(*)` }).from(schema.stops),
      db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces),
      db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces).where(eq(schema.explorePlaces.source, "curated")),
      db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces).where(eq(schema.explorePlaces.source, "osm")),
      db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces).where(eq(schema.explorePlaces.source, "user")),
      db.select({ n: sql<number>`count(*)` }).from(schema.posts),
      db.select({ n: sql<number>`coalesce(sum(${schema.posts.likes}), 0)` }).from(schema.posts),
      db.select({ n: sql<number>`count(*)` }).from(schema.expenses),
      db.select({ n: sql<number>`count(*)` }).from(schema.reservations),
      db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces).where(eq(schema.explorePlaces.approved, false)),
    ]);
    return {
      users: one(users),
      guests: one(guests),
      trips: one(trips),
      stops: one(stops),
      placesTotal: one(placesTotal),
      placesCurated: one(placesCurated),
      placesOsm: one(placesOsm),
      placesUser: one(placesUser),
      posts: one(posts),
      likes: one(likesRows),
      expenses: one(expenses),
      reservations: one(reservations),
      pendingPlaces: one(pendingPlaces),
    };
  }),

  /** Places awaiting moderation (approved = 0) with the submitter's name, newest first. */
  pendingPlaces: adminProcedure.query(async () => {
    const rows = await getDb()
      .select({ place: schema.explorePlaces, submitterName: schema.users.name })
      .from(schema.explorePlaces)
      .leftJoin(schema.users, eq(schema.explorePlaces.addedById, schema.users.id))
      .where(eq(schema.explorePlaces.approved, false))
      .orderBy(desc(schema.explorePlaces.id));
    return rows.map((r) => ({ ...r.place, submitterName: r.submitterName ?? "Traveler" }));
  }),

  /** Validate a submitted place - it becomes visible to everyone. */
  approvePlace: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await db.update(schema.explorePlaces).set({ approved: true }).where(eq(schema.explorePlaces.id, input.id));
    const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
    return row;
  }),

  /** Reject a submitted place - the row is removed from the corpus entirely. */
  rejectPlace: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.id));
    return { ok: true };
  }),

  /** Non-guest users with trip + post counts, newest first. Offset cursor. */
  users: adminProcedure.input(z.object(pageInput)).query(async ({ input }) => {
    const db = getDb();
    const limit = input.limit ?? 50;
    const offset = input.cursor ?? 0;
    const rows = await db
      .select()
      .from(schema.users)
      .where(notLike(schema.users.unionId, GUEST_PATTERN))
      .orderBy(desc(schema.users.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const ids = page.map((u) => u.id);

    const tripCounts = new Map<number, number>();
    const postCounts = new Map<number, number>();
    if (ids.length) {
      const [tripRows, postRows] = await Promise.all([
        db
          .select({ ownerId: schema.trips.ownerId, n: sql<number>`count(*)` })
          .from(schema.trips)
          .where(inArray(schema.trips.ownerId, ids))
          .groupBy(schema.trips.ownerId),
        db
          .select({ userId: schema.posts.userId, n: sql<number>`count(*)` })
          .from(schema.posts)
          .where(inArray(schema.posts.userId, ids))
          .groupBy(schema.posts.userId),
      ]);
      for (const r of tripRows) tripCounts.set(r.ownerId, Number(r.n));
      for (const r of postRows) postCounts.set(r.userId, Number(r.n));
    }

    return {
      users: page.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        role: u.role,
        createdAt: u.createdAt,
        lastSignInAt: u.lastSignInAt,
        trips: tripCounts.get(u.id) ?? 0,
        posts: postCounts.get(u.id) ?? 0,
      })),
      nextCursor: hasMore ? offset + limit : undefined,
    };
  }),

  /** Places database console: search/get/update/create/delete/bulk ops/stats. */
  places: placesDbRouter,

  /** Curate a place: fee, note, rating, price level, hidden-gem flag, description. */
  updatePlace: adminProcedure
    .input(
      z.object({
        id: z.number(),
        feeCents: z.number().int().min(0).nullable().optional(),
        feeNote: z.string().max(255).nullable().optional(),
        rating: z.number().min(0).max(5).optional(),
        priceLevel: z.number().int().min(1).max(4).optional(),
        hidden: z.boolean().optional(),
        description: z.string().max(10000).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const patch: Partial<
        Pick<schema.ExplorePlace, "feeCents" | "feeNote" | "rating" | "priceLevel" | "hidden" | "description">
      > = {};
      if (fields.feeCents !== undefined) patch.feeCents = fields.feeCents;
      if (fields.feeNote !== undefined) patch.feeNote = fields.feeNote;
      if (fields.rating !== undefined) patch.rating = fields.rating;
      if (fields.priceLevel !== undefined) patch.priceLevel = fields.priceLevel;
      if (fields.hidden !== undefined) patch.hidden = fields.hidden;
      if (fields.description !== undefined) patch.description = fields.description;
      const db = getDb();
      if (Object.keys(patch).length) {
        await db.update(schema.explorePlaces).set(patch).where(eq(schema.explorePlaces.id, id));
      }
      const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
      return row;
    }),

  deletePlace: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.id));
    return { ok: true };
  }),

  /** All journal posts with author names, newest first. */
  posts: adminProcedure.input(z.object(pageInput)).query(async ({ input }) => {
    const db = getDb();
    const limit = input.limit ?? 50;
    const offset = input.cursor ?? 0;
    const rows = await db
      .select()
      .from(schema.posts)
      .orderBy(desc(schema.posts.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const authorNames = new Map<number, string>();
    const authorIds = [...new Set(page.map((p) => p.userId))];
    if (authorIds.length) {
      const users = await db.select().from(schema.users).where(inArray(schema.users.id, authorIds));
      for (const u of users) authorNames.set(u.id, u.name ?? "Traveler");
    }

    return {
      posts: page.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        likes: p.likes,
        createdAt: p.createdAt,
        authorName: authorNames.get(p.userId) ?? "Traveler",
      })),
      nextCursor: hasMore ? offset + limit : undefined,
    };
  }),

  deletePost: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(schema.posts).where(eq(schema.posts.id, input.id));
    return { ok: true };
  }),

  /** Import OSM places for a city via the shared Overpass helper. */
  discoverCity: adminProcedure.input(z.object({ city: z.string().min(2) })).mutation(async ({ input }) => {
    try {
      return await importCityPlaces(input.city);
    } catch (e) {
      const message = e instanceof Error ? e.message : "City discovery failed";
      if (message.startsWith("Could not geocode")) {
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  }),

  /** City AI requests (pending first, then newest) with the requester's name + pending count. */
  cityRequests: adminProcedure.query(async () => {
    const rows = await getDb()
      .select({ request: schema.cityRequests, userName: schema.users.name })
      .from(schema.cityRequests)
      .leftJoin(schema.users, eq(schema.cityRequests.userId, schema.users.id))
      .orderBy(desc(schema.cityRequests.createdAt));
    const requests = rows.map((r) => ({ ...r.request, userName: r.userName ?? "Traveler" }));
    requests.sort((a, b) => (a.status === b.status ? 0 : a.status === "pending" ? -1 : 1));
    return {
      requests,
      pendingCount: requests.filter((r) => r.status === "pending").length,
    };
  }),

  /** Mark a city AI request handled - it leaves the pending queue. */
  markCityRequestDone: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await db.update(schema.cityRequests).set({ status: "done" }).where(eq(schema.cityRequests.id, input.id));
    const [row] = await db.select().from(schema.cityRequests).where(eq(schema.cityRequests.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
    return row;
  }),

  /** Support queue (open first, then newest) with the member's name, optionally filtered by status. */
  supportTickets: adminProcedure
    .input(z.object({ status: z.enum(["open", "closed"]).optional() }).optional())
    .query(async ({ input }) => {
      const rows = await getDb()
        .select({ ticket: schema.supportTickets, userName: schema.users.name, userEmail: schema.users.email })
        .from(schema.supportTickets)
        .leftJoin(schema.users, eq(schema.supportTickets.userId, schema.users.id))
        .where(input?.status ? eq(schema.supportTickets.status, input.status) : undefined)
        .orderBy(desc(schema.supportTickets.createdAt));
      const tickets = rows.map((r) => ({ ...r.ticket, userName: r.userName ?? "Traveler", userEmail: r.userEmail }));
      tickets.sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));
      return { tickets };
    }),

  /** Simple data analysis for the Support tab: open/closed totals + per-category counts. */
  ticketStats: adminProcedure.query(async () => {
    const db = getDb();
    const [statusRows, categoryRows] = await Promise.all([
      db
        .select({ status: schema.supportTickets.status, n: sql<number>`count(*)` })
        .from(schema.supportTickets)
        .groupBy(schema.supportTickets.status),
      db
        .select({ category: schema.supportTickets.category, n: sql<number>`count(*)` })
        .from(schema.supportTickets)
        .groupBy(schema.supportTickets.category),
    ]);
    const byStatus = { open: 0, closed: 0 };
    for (const r of statusRows) {
      if (r.status === "open") byStatus.open = Number(r.n);
      else if (r.status === "closed") byStatus.closed = Number(r.n);
    }
    const byCategory: Record<string, number> = {};
    for (const r of categoryRows) byCategory[r.category] = Number(r.n);
    return { ...byStatus, total: byStatus.open + byStatus.closed, byCategory };
  }),

  /** Close a ticket - the member's issue has been answered. */
  closeTicket: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await db.update(schema.supportTickets).set({ status: "closed" }).where(eq(schema.supportTickets.id, input.id));
    const [row] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
    return row;
  }),

  /** Reopen a ticket that still needs attention. */
  reopenTicket: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await db.update(schema.supportTickets).set({ status: "open" }).where(eq(schema.supportTickets.id, input.id));
    const [row] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
    return row;
  }),
});
