/**
 * r17-portal - private owner console ("accessible only to me").
 *
 * A SEPARATE, stronger-gated surface than /admin: the URL itself is a secret
 * (PORTAL_PATH_SECRET), then a portal ID + password, then a 2h httpOnly JWT
 * cookie (wf_portal, HS256 via PORTAL_SESSION_SECRET). Every check FAILS
 * CLOSED - an unset env var simply makes the portal unreachable (wrong
 * pathSecret → generic NOT_FOUND so the portal's existence is never revealed;
 * wrong ID/password → generic UNAUTHORIZED "Invalid credentials").
 *
 * Data procedures (places/images/dishes/stats) reuse the r15 admin places
 * helpers (placePatchSchema/toPlacePatch/bulkDeleteConditions/escapeLike)
 * instead of duplicating them, and the r13 Wikipedia/DBpedia photo helper in
 * lib/osm-photo.ts for image suggestions.
 */
import * as cookie from "cookie";
import * as jose from "jose";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import {
  bulkDeleteByFilterSchema,
  bulkDeleteConditions,
  hasBulkCriteria,
  placeCreateSchema,
  placePatchSchema,
  placeSearchConditions,
  toPlacePatch,
  VERDICT_VALUES,
} from "./admin-router";
import { createRouter, publicQuery } from "./middleware";
import { env } from "./lib/env";
import { suggestPlacePhoto } from "./lib/osm-photo";
import { searchWebImages } from "./lib/web-image-search"; // r19-portal
import {
  cleanAbstract,
  composeDescription,
  fetchDbpediaAbstract,
} from "./lib/place-story"; // r19-portal
import type { TrpcContext } from "./context";

// ─── credentials (fail closed: empty env never grants access) ────────────────

const PORTAL_COOKIE = "wf_portal";
const SESSION_TTL_S = 2 * 60 * 60; // 2h

/** Read the portal env config. Any missing piece → the portal is off. */
function portalConfig() {
  return {
    pathSecret: process.env.PORTAL_PATH_SECRET ?? "",
    portalId: process.env.PORTAL_ID ?? "",
    password: process.env.PORTAL_PASSWORD ?? "",
    sessionSecret: process.env.PORTAL_SESSION_SECRET ?? "",
  };
}

/** Length-independent string compare (hash first so lengths never leak). */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ─── per-IP rate limit: 5 failures → 15-minute lockout ──────────────────────

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

type RateEntry = { failures: number; lockedUntil: number };
const attempts = new Map<string, RateEntry>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Exported for tests - wipes the in-memory buckets. */
export function resetPortalRateLimits(): void {
  attempts.clear();
}

/** Milliseconds until the lockout ends (0 = not locked). */
export function portalLockoutRemaining(key: string): number {
  const entry = attempts.get(key);
  if (!entry) return 0;
  if (entry.lockedUntil > Date.now()) return entry.lockedUntil - Date.now();
  if (entry.lockedUntil) attempts.delete(key); // expired lockout → clean slate
  return 0;
}

function recordFailure(key: string): void {
  const entry = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.failures = 0;
  }
  attempts.set(key, entry);
}

/** Attempts left before lockout (for the UI hint - not a secret). */
export function portalAttemptsLeft(key: string): number {
  const entry = attempts.get(key);
  if (!entry) return MAX_FAILURES;
  return Math.max(0, MAX_FAILURES - entry.failures);
}

// ─── session JWT ─────────────────────────────────────────────────────────────

async function signPortalToken(sessionSecret: string): Promise<string> {
  const secret = new TextEncoder().encode(sessionSecret);
  return new jose.SignJWT({ sub: "owner", scope: "portal" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(secret);
}

async function verifyPortalToken(token: string): Promise<boolean> {
  const { sessionSecret } = portalConfig();
  if (!token || !sessionSecret) return false;
  try {
    const secret = new TextEncoder().encode(sessionSecret);
    const { payload } = await jose.jwtVerify(token, secret, { algorithms: ["HS256"] });
    return payload.sub === "owner" && payload.scope === "portal";
  } catch {
    return false;
  }
}

function portalCookieFrom(req: Request): string {
  const header = req.headers.get("cookie") ?? "";
  const parsed = cookie.parse(header);
  return parsed[PORTAL_COOKIE] ?? "";
}

function setPortalCookie(ctx: TrpcContext, token: string, maxAge: number): void {
  ctx.resHeaders.append(
    "set-cookie",
    cookie.serialize(PORTAL_COOKIE, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: env.isProduction, // https-only in prod; plain http on localhost dev
      maxAge,
    }),
  );
}

/** Guard for every portal data procedure: a verified wf_portal cookie JWT. */
export const portalProcedure = publicQuery.use(async ({ ctx, next }) => {
  const ok = await verifyPortalToken(portalCookieFrom(ctx.req));
  if (!ok) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Portal session required" });
  }
  return next({ ctx });
});

const affectedRows = (res: unknown) =>
  Number((res as { affectedRows?: number }[])?.[0]?.affectedRows ?? 0);

// ─── places sub-router (mirrors r15 admin.places, portal-guarded) ───────────

const portalPlacesRouter = createRouter({
  search: portalProcedure
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

      // r19-portal: same smart-search conditions as admin.places.search.
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

  get: portalProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const [row] = await getDb()
      .select()
      .from(schema.explorePlaces)
      .where(eq(schema.explorePlaces.id, input.id))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
    return row;
  }),

  update: portalProcedure
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

  create: portalProcedure.input(placeCreateSchema).mutation(async ({ input }) => {
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
      addedById: null, // the portal has no user account - owner acts directly
    };
    const res = await db.insert(schema.explorePlaces).values(values);
    const id = Number((res as unknown as [{ insertId?: number }])[0]?.insertId ?? 0);
    const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, id)).limit(1);
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert failed" });
    return row;
  }),

  delete: portalProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const res = await getDb().delete(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.id));
    return { ok: true, deleted: affectedRows(res) };
  }),

  bulkDelete: portalProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1).max(500) }))
    .mutation(async ({ input }) => {
      const res = await getDb().delete(schema.explorePlaces).where(inArray(schema.explorePlaces.id, input.ids));
      return { ok: true, deleted: affectedRows(res) };
    }),

  bulkDeleteByFilter: portalProcedure.input(bulkDeleteByFilterSchema).mutation(async ({ input }) => {
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

  /**
   * "Suggest" next to the Description field (r19-portal): DBpedia abstract →
   * cleanAbstract, else the honest composed fallback. Returns the text
   * WITHOUT writing — the owner edits in the textarea before saving.
   */
  suggestDescription: portalProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        city: z.string().trim().min(1).max(255),
        country: z.string().trim().max(255).optional(),
        category: z.string().trim().max(32).optional(),
        tags: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const hit = await fetchDbpediaAbstract(input.name, input.city);
        const cleaned = hit ? cleanAbstract(hit.abstract) : null;
        if (cleaned) return { description: cleaned, source: "dbpedia" as const };
      } catch {
        // network blocked / DBpedia down → fall through to the composed text
      }
      return {
        description: composeDescription({
          name: input.name,
          city: input.city,
          country: input.country ?? "",
          category: input.category ?? "",
          tags: input.tags ?? [],
        }),
        source: "composed" as const,
      };
    }),

  stats: portalProcedure.query(async () => {
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

// ─── images sub-router ───────────────────────────────────────────────────────

const portalImagesRouter = createRouter({
  /** Manual photo: set image + photoSource='manual' + optional attribution. */
  set: portalProcedure
    .input(
      z.object({
        placeId: z.number().int(),
        url: z.string().trim().url().max(500),
        attribution: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(schema.explorePlaces)
        .set({
          image: input.url,
          photoSource: "manual",
          photoAttribution: input.attribution?.trim() ? input.attribution.trim() : null,
        })
        .where(eq(schema.explorePlaces.id, input.placeId));
      const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.placeId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
      return row;
    }),

  /** Clear image + photoSource + photoAttribution (back to pool fallback). */
  remove: portalProcedure
    .input(z.object({ placeId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(schema.explorePlaces)
        .set({ image: null, photoSource: null, photoAttribution: null })
        .where(eq(schema.explorePlaces.id, input.placeId));
      const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.placeId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
      return row;
    }),

  /**
   * "Find on Wikipedia": r13 helper (Wikipedia REST, DBpedia fallback) - returns
   * a candidate WITHOUT writing; confirming calls images.set with the URL.
   */
  suggest: portalProcedure
    .input(z.object({ placeId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.placeId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
      const candidate = await suggestPlacePhoto(row.name, row.city);
      return { place: row, candidate };
    }),

  /**
   * "Find online" (r19-portal): web image search (Openverse → DuckDuckGo)
   * beyond Wikipedia. Returns candidates WITHOUT writing; confirming calls
   * images.set. Total source failure → { candidates: [], unavailable: true },
   * never an error (the sources are blocked from some networks).
   */
  webSearch: portalProcedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(200),
        count: z.number().int().min(1).max(12).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return searchWebImages(input.query, input.count ?? 9);
    }),
});

// ─── signature dishes sub-router (r16 tables) ───────────────────────────────

const portalDishesRouter = createRouter({
  /** Distinct cities that have signature dishes (for the city selector). */
  cities: portalProcedure.query(async () => {
    const rows = await getDb()
      .selectDistinct({ city: schema.signatureDishes.city, country: schema.signatureDishes.country })
      .from(schema.signatureDishes)
      .orderBy(asc(schema.signatureDishes.country), asc(schema.signatureDishes.city));
    return rows;
  }),

  /** Dishes of one city, each with its mapped places (position order). */
  list: portalProcedure
    .input(z.object({ city: z.string().trim().min(1).max(128), country: z.string().trim().max(128).optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const where = input.country
        ? and(eq(schema.signatureDishes.city, input.city), eq(schema.signatureDishes.country, input.country))
        : eq(schema.signatureDishes.city, input.city);
      const dishes = await db
        .select()
        .from(schema.signatureDishes)
        .where(where)
        .orderBy(asc(schema.signatureDishes.position), asc(schema.signatureDishes.id));
      const ids = dishes.map((d) => d.id);
      const places = ids.length
        ? await db
            .select()
            .from(schema.signatureDishPlaces)
            .where(inArray(schema.signatureDishPlaces.dishId, ids))
            .orderBy(asc(schema.signatureDishPlaces.position), asc(schema.signatureDishPlaces.id))
        : [];
      return dishes.map((d) => ({ ...d, places: places.filter((p) => p.dishId === d.id) }));
    }),

  updateDish: portalProcedure
    .input(
      z.object({
        id: z.number().int(),
        dish: z.string().trim().min(1).max(128).optional(),
        blurb: z.string().trim().max(10000).nullable().optional(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const patch: Partial<Pick<schema.SignatureDish, "dish" | "blurb" | "position">> = {};
      if (input.dish !== undefined) patch.dish = input.dish;
      if (input.blurb !== undefined) patch.blurb = input.blurb?.trim() ? input.blurb.trim() : null;
      if (input.position !== undefined) patch.position = input.position;
      const db = getDb();
      if (Object.keys(patch).length) {
        await db.update(schema.signatureDishes).set(patch).where(eq(schema.signatureDishes.id, input.id));
      }
      const [row] = await db.select().from(schema.signatureDishes).where(eq(schema.signatureDishes.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Dish not found" });
      return row;
    }),

  deleteDish: portalProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    // dishId FK is ON DELETE CASCADE - the dish-places go with it.
    const res = await getDb().delete(schema.signatureDishes).where(eq(schema.signatureDishes.id, input.id));
    return { ok: true, deleted: affectedRows(res) };
  }),

  updateDishPlace: portalProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().trim().min(1).max(191).optional(),
        why: z.string().trim().max(255).nullable().optional(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const patch: Partial<Pick<schema.SignatureDishPlace, "name" | "why" | "position">> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.why !== undefined) patch.why = input.why?.trim() ? input.why.trim() : null;
      if (input.position !== undefined) patch.position = input.position;
      const db = getDb();
      if (Object.keys(patch).length) {
        await db.update(schema.signatureDishPlaces).set(patch).where(eq(schema.signatureDishPlaces.id, input.id));
      }
      const [row] = await db.select().from(schema.signatureDishPlaces).where(eq(schema.signatureDishPlaces.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Dish place not found" });
      return row;
    }),

  deleteDishPlace: portalProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const res = await getDb().delete(schema.signatureDishPlaces).where(eq(schema.signatureDishPlaces.id, input.id));
    return { ok: true, deleted: affectedRows(res) };
  }),
});

// ─── top-level portal router ─────────────────────────────────────────────────

export const portalRouter = createRouter({
  /**
   * Path-secret gate for PAGE RENDER: the client asks this before showing
   * the sign-in card, so a wrong /portal/:pathSecret renders a plain 404 -
   * indistinguishable from a route that doesn't exist. No lockout side
   * effects (a 64-bit secret is not enumerable); brute-force protection
   * lives on login itself.
   */
  checkPath: publicQuery
    .input(z.object({ pathSecret: z.string().max(128) }))
    .query(({ input }) => {
      if (!safeEqual(input.pathSecret, portalConfig().pathSecret)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      return { ok: true as const };
    }),

  /**
   * Three-factor gate: path secret + portal ID + password. Wrong path secret
   * → generic NOT_FOUND (the portal doesn't exist as far as you know). Wrong
   * ID/password → generic UNAUTHORIZED. 5 failures from one IP+pathSecret →
   * 15-minute lockout. Success → httpOnly wf_portal cookie (2h) + the token.
   */
  login: publicQuery
    .input(
      z.object({
        pathSecret: z.string().max(128),
        portalId: z.string().max(128),
        password: z.string().max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cfg = portalConfig();
      const key = `${clientIp(ctx.req)}|${input.pathSecret}`;

      const lockedMs = portalLockoutRemaining(key);
      if (lockedMs > 0) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Too many attempts, try again later",
          cause: { lockedMinutes: Math.ceil(lockedMs / 60000) },
        });
      }

      // The path secret is checked first; a wrong one is indistinguishable
      // from a route that doesn't exist.
      if (!safeEqual(input.pathSecret, cfg.pathSecret)) {
        recordFailure(key);
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      if (!safeEqual(input.portalId, cfg.portalId) || !safeEqual(input.password, cfg.password)) {
        recordFailure(key);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
          cause: { attemptsLeft: portalAttemptsLeft(key) },
        });
      }
      // Session signing must also be configured - fail closed otherwise.
      if (!cfg.sessionSecret) {
        recordFailure(key);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }

      attempts.delete(key);
      const token = await signPortalToken(cfg.sessionSecret);
      setPortalCookie(ctx, token, SESSION_TTL_S);
      return { ok: true as const, token };
    }),

  /** Clear the wf_portal cookie. */
  logout: publicQuery.mutation(async ({ ctx }) => {
    setPortalCookie(ctx, "", 0);
    return { ok: true as const };
  }),

  /** Page bootstrap: is the current wf_portal cookie still valid? */
  session: publicQuery.query(async ({ ctx }) => {
    const ok = await verifyPortalToken(portalCookieFrom(ctx.req));
    return { ok };
  }),

  /** Console header totals. */
  stats: portalProcedure.query(async () => {
    const db = getDb();
    const one = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0);
    const [places, withImage, famous, dishes, countries, cities] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces),
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.explorePlaces)
        .where(and(isNotNull(schema.explorePlaces.image), ne(schema.explorePlaces.image, ""))),
      db.select({ n: sql<number>`count(*)` }).from(schema.explorePlaces).where(eq(schema.explorePlaces.famousEatery, true)),
      db.select({ n: sql<number>`count(*)` }).from(schema.signatureDishes),
      db.select({ n: sql<number>`count(distinct ${schema.explorePlaces.country})` }).from(schema.explorePlaces),
      db.select({ n: sql<number>`count(distinct ${schema.explorePlaces.city})` }).from(schema.explorePlaces),
    ]);
    return {
      places: one(places),
      placesWithImage: one(withImage),
      famousEateries: one(famous),
      signatureDishes: one(dishes),
      countries: one(countries),
      cities: one(cities),
    };
  }),

  places: portalPlacesRouter,
  images: portalImagesRouter,
  dishes: portalDishesRouter,
});
