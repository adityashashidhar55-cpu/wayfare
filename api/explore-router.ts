import { and, desc, eq, gte, inArray, isNull, like, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "@db/schema";
import { PREFERENCE_STYLES } from "@contracts/premium";
import { getDb } from "./queries/connection";
import {
  AREA_MAX_SPAN_DEG,
  NEARBY_FOOD_AMENITIES,
  fetchArea,
  fetchNearby,
  importCityPlaces,
  normalizeElement,
  reverseGeocodePoint,
  searchPhoton,
  searchPhotonCities,
  type OsmSearchHit,
  type OverpassElement,
  type PhotonCityHit,
} from "./queries/overpass";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import { normPlace } from "./queries/place-match";
import { isStatueLike, profileStyles, styleMatchScore, STATUE_PENALTY } from "./lib/style-map";
import { getGlobalFeed, FEED_COLUMNS, type FeedPlace } from "./lib/explore-feed";
import { blurbFor, fameScoreFor, isGenericName, normalizeNameKey } from "./lib/place-quality";
import { pickFamousEatsFallback } from "./lib/famous-eats";
import { resolveTz, todayIn } from "./lib/tz";

/**
 * Suggestion-surface name filter (mission r11-quality): hide OSM
 * placeholder-named rows ("Park", "Central Market", "Sightseeing") from
 * every place feed. Search surfaces keep a generic row only when the user
 * literally typed its name. Non-destructive - rows stay in the corpus.
 */
function keepForQuery(name: string, q: string): boolean {
  if (!isGenericName(name)) return true;
  const n = name.trim().toLowerCase();
  const query = q.trim().toLowerCase();
  return n.includes(query) || query.includes(n);
}

/** Great-circle distance in km (haversine). */
function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Case/whitespace-insensitive name key used for place dedupe. */
function normalizePlaceName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Moderation visibility rule, shared by every query that lists or searches
 * explore_places: a place is visible when it has been approved by an admin,
 * or when the caller submitted it themselves (so they can watch their pending
 * places). Unauthenticated callers see only approved rows.
 */
function placeVisibleTo(userId?: number): SQL {
  const approved = eq(schema.explorePlaces.approved, true);
  if (userId == null) return approved;
  // two-argument `or` is always defined - the type just can't express it
  return or(approved, eq(schema.explorePlaces.addedById, userId))!;
}

/**
 * Tag vocabulary for user-submitted places - the union of tags already used
 * by db/seed.ts, db/seed-research.ts and the OSM importer (normalizeElement),
 * so crowdsourced rows stay inside the existing corpus vocabulary.
 */
export const PLACE_TAG_VOCAB = new Set([
  "arch", "art", "bakery", "basalt", "beach", "beachfront", "bikes", "bookshops",
  "buddha", "calm", "castle", "casual", "cathedral", "church", "cocktails",
  "coffee", "culture", "day-trip", "deer", "design", "dinner", "drinks",
  "easy-walk", "evening", "family", "food", "garden", "gardens", "geothermal",
  "glacier", "gold", "haggling", "harbor", "hike", "historic", "history",
  "hot-dog", "hot-spring", "iconic", "izakaya", "kissaten", "lake", "landmark",
  "late-night", "lunch", "market", "markets", "mezcal", "monument", "museum",
  "nature", "neon", "night", "nightlife", "old-town", "palace", "park",
  "performers", "photography", "piazza", "picnic", "pools", "puffins", "quiet",
  "ramen", "reservation", "retro", "riad", "river", "riverfront", "rooftop",
  "ruins", "seafood", "small-group", "solo-dining", "souk", "spa", "spices",
  "square", "street-food", "sunset", "tasting", "tea", "temple", "tilework",
  "tower", "viewpoint", "views", "walk", "waterfall", "whisky", "wine-bar",
]);

const addPlaceInput = z.object({
  name: z.string().trim().min(2).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z.enum(["activity", "food"]),
  city: z.string().trim().min(1).max(255),
  country: z.string().trim().min(1).max(255),
  address: z.string().trim().max(512).optional(),
  tags: z
    .array(z.string().trim().min(2).max(32))
    .max(3)
    .refine((list) => list.every((t) => PLACE_TAG_VOCAB.has(t.toLowerCase())), {
      message: "Tags must come from the existing Wayfare tag vocabulary",
    })
    .optional(),
  styles: z.array(z.enum(PREFERENCE_STYLES)).max(2).optional(),
  description: z.string().trim().max(280).optional(),
});

interface NearbyResult {
  name: string;
  lat: number;
  lng: number;
  category: "food" | "activity";
  address?: string;
  distanceM: number;
  osmId: string;
  inCorpus: boolean;
  placeId: number | null;
}

// ── Photon city cache (api_cache) ───────────────────────────────────────────
// The ⌘K palette geocodes arbitrary city names on every keystroke; caching
// keeps repeated queries ("paris", "pari", "paris" again) off Photon's rate
// limits. Failures are never cached, so an Overpass/Photon outage self-heals.
const PHOTON_CITY_CACHE_PREFIX = "photon:cities:";
const PHOTON_CITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

async function cachedPhotonCities(query: string): Promise<PhotonCityHit[]> {
  const key = `${PHOTON_CITY_CACHE_PREFIX}${query.trim().toLowerCase()}`;
  const db = getDb();
  try {
    const rows = await db.select().from(schema.apiCache).where(eq(schema.apiCache.k, key)).limit(1);
    const row = rows[0];
    if (row && row.expiresAt.getTime() > Date.now()) {
      return JSON.parse(row.v) as PhotonCityHit[];
    }
  } catch {
    // cache unreadable - fall through to the live fetch
  }
  const hits = await searchPhotonCities(query, 4);
  try {
    const v = JSON.stringify(hits);
    const expiresAt = new Date(Date.now() + PHOTON_CITY_CACHE_TTL_MS);
    await db
      .insert(schema.apiCache)
      .values({ k: key, v, expiresAt })
      .onDuplicateKeyUpdate({ set: { v, expiresAt } });
  } catch {
    // cache write failed - results are still returned uncached
  }
  return hits;
}

// r22-speed: the global feed is scored and ranked inside SQL (exact
// transcription of the JS scorer) and cached per (styles, style, maxPrice)
// key - see api/lib/explore-feed.ts. No whole-corpus structure is retained
// in the process anymore (the r21-perf 60s corpus cache pushed RSS past
// 670MB and still paid a 410k-row scan every minute).
type LightPlace = {
  id: number;
  name: string;
  city: string;
  tags: string[] | null;
  styles: string[] | null;
  rating: number | null;
  hidden: boolean;
  priceLevel: number | null;
  feeCents: number | null;
  qualityScore?: number | null;
  isChain?: boolean | null;
  isJunk?: boolean | null;
};

const LIGHT_COLUMNS = {
  id: schema.explorePlaces.id,
  name: schema.explorePlaces.name,
  city: schema.explorePlaces.city,
  tags: schema.explorePlaces.tags,
  styles: schema.explorePlaces.styles,
  rating: schema.explorePlaces.rating,
  hidden: schema.explorePlaces.hidden,
  priceLevel: schema.explorePlaces.priceLevel,
  feeCents: schema.explorePlaces.feeCents,
  // r28: quality signals - the city feed scores in JS and needs them too.
  qualityScore: schema.explorePlaces.qualityScore,
  isChain: schema.explorePlaces.isChain,
  isJunk: schema.explorePlaces.isJunk,
} as const;

/**
 * r27: on-demand corpus filling.
 *
 * Below this many rows a city feed is treated as empty and we try an import.
 * A handful of stray user submissions shouldn't count as coverage.
 */
const MIN_CITY_PLACES = 8;

/**
 * Cities used to bootstrap a completely empty corpus, chosen to cover the
 * India-first audience plus enough of the rest of the world that the global
 * feed doesn't look regional.
 */
const BOOTSTRAP_CITIES = ["Bengaluru", "Goa", "Jaipur", "Paris", "Bangkok", "Tokyo"];

/** Guards against several concurrent feed loads all importing the same city. */
const importsInFlight = new Map<string, Promise<boolean>>();
let bootstrapAttemptedAt = 0;

/** Import a city, coalesced and never throwing. Returns whether rows landed. */
async function tryImportCity(city: string): Promise<boolean> {
  const key = city.trim().toLowerCase();
  const existing = importsInFlight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await importCityPlaces(city);
      // `inserted` is new rows this run; `total` is the city's row count after
      // the import. Either being non-zero means the feed has something to show
      // (a city imported moments ago by a concurrent request inserts 0).
      return (res?.inserted ?? 0) > 0 || (res?.total ?? 0) > 0;
    } catch (e) {
      // Overpass being slow or a city we can't geocode must degrade to an
      // empty feed, not a 500 on the home page.
      console.warn(`explore: on-demand import failed for "${city}"`, e);
      return false;
    } finally {
      importsInFlight.delete(key);
    }
  })();
  importsInFlight.set(key, p);
  return p;
}

/**
 * Fill a completely empty corpus. Imports the first starter city inline so the
 * caller gets something back on this request, and continues with the rest in
 * the background rather than making one unlucky user wait for six Overpass
 * round-trips.
 *
 * Rate-limited to once every 10 minutes per process: if Overpass is down we
 * must not hammer it on every page load.
 */
async function bootstrapCorpus(): Promise<void> {
  if (Date.now() - bootstrapAttemptedAt < 10 * 60 * 1000) return;
  bootstrapAttemptedAt = Date.now();
  const [first, ...rest] = BOOTSTRAP_CITIES;
  if (first) await tryImportCity(first);
  void (async () => {
    for (const city of rest) {
      await tryImportCity(city);
    }
  })();
}

export const exploreRouter = createRouter({
  /** Personalized place feed - scores places by overlap with the taste profile. */
  list: authedQuery
    .input(z.object({ style: z.string().optional(), city: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      // r22-speed: prefs and the caller's own submissions are independent -
      // fetch them concurrently (one less remote round-trip per feed load).
      const prefP = db
        .select()
        .from(schema.preferences)
        .where(eq(schema.preferences.userId, ctx.user.id))
        .limit(1);
      const ownP = input?.city
        ? null
        : db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.addedById, ctx.user.id));
      const [prefRows, own] = await Promise.all([prefP, ownP]);
      const pref = prefRows[0];
      // r29: interests and cuisines now count. They were collected by the
      // onboarding quiz and read by nothing until this line.
      const userStyles = profileStyles(pref);
      const budgetBand = pref?.budgetBand ?? "mid";
      let maxPrice = budgetBand === "shoestring" ? 1 : budgetBand === "mid" ? 2 : budgetBand === "comfort" ? 3 : 4;
      // "budget" as a chosen travel style is a hard signal too - cap at 2
      if (userStyles.has("budget")) maxPrice = Math.min(maxPrice, 2);

      const scorePlace = (p: LightPlace) => {
        const styles = p.styles ?? [];
        // Style-map aware: canonical styles-column overlap (same 10-pt
        // weight) + tag overlap, so "nightlife"/"music" asks boost
        // bars/clubs instead of falling back to rating order (statues).
        // `?? 0` - keep in sync with api/lib/explore-feed.ts (both the SQL
        // COALESCE and the JS re-score).
        let score = styleMatchScore(p, userStyles) + (p.rating ?? 0) * 2 + (p.hidden ? 1.5 : 0);
        // r28: same quality term as api/lib/explore-feed.ts. All THREE scorers
        // (this one, the SQL in feedScoreSql, and the JS re-score) must agree.
        score += 0.25 * (p.qualityScore ?? 0);
        if (p.isChain) score -= 8;
        if (p.isJunk) score -= 50;
        if (isStatueLike(p)) score -= STATUE_PENALTY; // statues below real attractions
        const affordable = (p.priceLevel ?? 2) <= maxPrice;
        if (affordable) score += 3;
        if (userStyles.has("budget") && p.feeCents === 0) score += 2; // free gems first
        if (input?.style && !styles.includes(input.style)) score -= 100;
        return {
          matchScore: Math.round(score * 10) / 10,
          matchStyles: styles.filter((s) => userStyles.has(s)),
          aboveBudget: !affordable,
        };
      };

      if (!input?.city) {
        // r22-speed: global feed comes from the scored-feed cache (SQL-ranked,
        // hydrated, single-flight). Only the caller's own submissions are
        // merged per request, exactly like the old pipeline merged them into
        // the corpus before scoring (stable ties keep corpus rows first).
        let feed = await getGlobalFeed({ styles: [...userStyles], style: input?.style ?? null, maxPrice });
        // r27: EMPTY-CORPUS FALLBACK. On a fresh database this feed was simply
        // blank - the main /explore page, the first thing a new user sees.
        // CityBuilder and explore.discover already import on demand via
        // importCityPlaces (OSM/Overpass, free, keyless); the main feed was the
        // one surface with no such path, and nothing seeds at build or boot.
        if (!feed.length) {
          await bootstrapCorpus();
          feed = await getGlobalFeed({ styles: [...userStyles], style: input?.style ?? null, maxPrice });
        }
        // Own rows are scored on the fly, so they need the styles column
        // that FEED_COLUMNS trims; they are a handful per user at most.
        let hydrated: FeedPlace[];
        const ownRows = own ?? [];
        if (!ownRows.length) {
          hydrated = feed;
        } else {
          const ownIds = new Set(ownRows.map((p) => Number(p.id)));
          const ownScored = ownRows.map((p) => ({ ...p, ...scorePlace(p) }));
          const base = feed.filter((p) => !ownIds.has(Number(p.id)));
          hydrated = [...base, ...ownScored].sort((a, b) => {
            if (a.aboveBudget !== b.aboveBudget) return a.aboveBudget ? 1 : -1;
            return b.matchScore - a.matchScore;
          });
          // `.sort` is stable, so own rows keep their submission order within
          // ties, matching the old [...corpus, ...own] input order.
          hydrated = hydrated.slice(0, 600);
        }
        return { places: hydrated, preferences: pref ?? null, maxPriceLevel: maxPrice };
      }

      // City feed: the city filter is pushed into SQL (r21-perf: a city feed
      // does not haul the whole corpus over the wire) and survivors are
      // hydrated by id below, keeping the response shape identical.
      let places: LightPlace[] = await db
        .select(LIGHT_COLUMNS)
        .from(schema.explorePlaces)
        .where(and(placeVisibleTo(ctx.user.id), eq(schema.explorePlaces.city, input.city)));
      // r27: same on-demand import for a city we simply don't have yet. A
      // traveller searching a city outside the corpus got an empty page that
      // looked like the app was broken, even though the importer that would
      // have filled it was one function call away.
      if (places.length < MIN_CITY_PLACES) {
        const imported = await tryImportCity(input.city);
        if (imported) {
          places = await db
            .select(LIGHT_COLUMNS)
            .from(schema.explorePlaces)
            .where(and(placeVisibleTo(ctx.user.id), eq(schema.explorePlaces.city, input.city)));
        }
      }
      const scored = places
        .filter((p) => !isGenericName(p.name)) // hide OSM placeholder names from the suggestion feed
        .map((p) => ({ ...p, ...scorePlace(p) }))
        .sort((a, b) => {
          // Hard budget honoring: unaffordable places always sort after affordable ones
          if (a.aboveBudget !== b.aboveBudget) return a.aboveBudget ? 1 : -1;
          return b.matchScore - a.matchScore;
        });
      // r11 payload guard: the corpus is tens of thousands of rows now -
      // shipping it all made /explore a multi-MB, seconds-long load ("UX
      // struggles to go down in screens"). Browsing only ever shows the top
      // matches; search/discover reach the long tail on demand.
      const capped = scored.slice(0, 1500);
      // Hydrate the survivors with the columns the cards render (r22-speed).
      const ids = capped.map((p) => Number(p.id));
      const fullRows = ids.length
        ? await db.select(FEED_COLUMNS).from(schema.explorePlaces).where(inArray(schema.explorePlaces.id, ids))
        : [];
      const byId = new Map(fullRows.map((r) => [Number(r.id), r]));
      const hydrated = capped.flatMap((p) => {
        const full = byId.get(Number(p.id));
        // A row deleted between the two queries is dropped, not leaked partial.
        return full ? [{ ...full, matchScore: p.matchScore, matchStyles: p.matchStyles, aboveBudget: p.aboveBudget }] : [];
      });
      return { places: hydrated, preferences: pref ?? null, maxPriceLevel: maxPrice };
    }),

  /**
   * Live place search: local corpus first, then OpenStreetMap via Photon.
   * Photon failures never fail the request - corpus-only results are returned.
   */
  search: authedQuery
    .input(
      z.object({
        query: z.string().min(2),
        near: z.object({ lat: z.number(), lng: z.number() }).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 8;
      const q = input.query.trim();
      if (q.length < 2) return { results: [] };
      const db = getDb();
      const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;
      const corpus = await db
        .select()
        .from(schema.explorePlaces)
        .where(
          and(
            placeVisibleTo(ctx.user.id),
            or(like(schema.explorePlaces.name, pattern), like(schema.explorePlaces.city, pattern)),
          ),
        )
        .limit(limit);
      const corpusResults = corpus
        .filter((p) => keepForQuery(p.name, q))
        .map((p) => ({ ...p, source: "corpus" as const }));

      let osmResults: OsmSearchHit[] = [];
      try {
        const hits = await searchPhoton(q, input.near, 8);
        osmResults = hits.filter(
          (h) =>
            keepForQuery(h.name, q) &&
            !corpus.some(
              (p) =>
                p.lat != null &&
                p.lng != null &&
                p.name.trim().toLowerCase() === h.name.trim().toLowerCase() &&
                kmBetween(p.lat, p.lng, h.lat, h.lng) <= 0.5,
            ),
        );
      } catch {
        // Photon unavailable - corpus-only results
      }
      return { results: [...corpusResults, ...osmResults] };
    }),

  /**
   * Global ⌘K palette search - one round-trip, four sections:
   *   trips:        the caller's trips matching title/destination (top 4)
   *   cities:       corpus cities matching by name, with place counts (top 4)
   *   photonCities: geocodable cities worldwide via Photon (api_cache-cached),
   *                 so non-corpus cities can be opened in the city builder
   *   places:       corpus places matching by name (top 6)
   * Additive sibling of `search` (which stays map-scoped); never throws on
   * Photon failure - the worldwide lane just comes back empty.
   */
  globalSearch: authedQuery
    .input(z.object({ query: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const q = input.query.trim();
      if (q.length < 2) {
        return { trips: [], cities: [], places: [], photonCities: [] as PhotonCityHit[] };
      }
      const db = getDb();
      const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;

      // ── Your trips (member trips only) - earliest title/destination hit first
      const memberships = await db
        .select({ tripId: schema.tripMembers.tripId })
        .from(schema.tripMembers)
        .where(eq(schema.tripMembers.userId, ctx.user.id));
      const tripIds = memberships.map((m) => m.tripId);
      // r25: judged per trip in its own zone (see api/lib/tz.ts).
      const today = todayIn(resolveTz(ctx.user.timezone));
      const trips = tripIds.length
        ? (
            await db
              .select()
              .from(schema.trips)
              .where(
                and(
                  inArray(schema.trips.id, tripIds),
                  or(like(schema.trips.title, pattern), like(schema.trips.destination, pattern)),
                ),
              )
              .orderBy(desc(schema.trips.startDate))
              .limit(4)
          ).map((t) => ({
            id: t.id,
            title: t.title,
            destination: t.destination,
            startDate: t.startDate,
            endDate: t.endDate,
            coverImage: t.coverImage,
            status: (t.endDate < today ? "past" : "upcoming") as "past" | "upcoming",
          }))
        : [];

      // ── Corpus places matching by name - closest textual match first.
      // Generic placeholder names only survive when the user typed them.
      const places = (
        await db
          .select()
          .from(schema.explorePlaces)
          .where(and(placeVisibleTo(ctx.user.id), like(schema.explorePlaces.name, pattern)))
          .orderBy(sql`LOCATE(${q}, ${schema.explorePlaces.name})`)
          .limit(12)
      )
        .filter((p) => keepForQuery(p.name, q))
        .slice(0, 6);

      // ── Corpus cities matching by name, with visible place counts
      const cities = await db
        .select({
          city: schema.explorePlaces.city,
          country: schema.explorePlaces.country,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(schema.explorePlaces)
        .where(and(placeVisibleTo(ctx.user.id), like(schema.explorePlaces.city, pattern)))
        .groupBy(schema.explorePlaces.city, schema.explorePlaces.country)
        .orderBy(sql`LOCATE(${q}, ${schema.explorePlaces.city})`, sql`count(*) DESC`)
        .limit(4);

      // ── Worldwide city lane (Photon, cached) - never fails the request
      const photonCities = await cachedPhotonCities(q);

      return { trips, cities, places, photonCities };
    }),

  /**
   * Discover a city: geocode it, pull named POIs from Overpass (OSM) and
   * import them into explore_places. Idempotent per city.
   */
  discover: authedQuery
    .input(z.object({ city: z.string().min(2) }))
    .mutation(async ({ input }) => {
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

  /**
   * Crowdsourced place submission. Dedupes on normalized name within 0.3 km -
   * a conflict returns the existing row instead of throwing so callers can
   * show an "already in your places" state. New rows enter the corpus as
   * source 'user', unrated (rating null), mid price, never hidden, and
   * UNAPPROVED - they stay visible only to the submitter until an admin
   * validates them (see admin.pendingPlaces / approvePlace / rejectPlace).
   */
  addPlace: authedQuery.input(addPlaceInput).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const nameKey = normalizePlaceName(input.name);
    const sameName = await db
      .select()
      .from(schema.explorePlaces)
      .where(sql`LOWER(TRIM(${schema.explorePlaces.name})) = ${nameKey}`);
    const existing = sameName.find(
      (p) =>
        p.lat != null &&
        p.lng != null &&
        kmBetween(p.lat, p.lng, input.lat, input.lng) <= 0.3,
    );
    if (existing) return { conflict: true as const, existing };

    const result = await db.insert(schema.explorePlaces).values({
      name: input.name,
      city: input.city,
      country: input.country,
      lat: input.lat,
      lng: input.lng,
      category: input.category,
      tags: (input.tags ?? []).map((t) => t.toLowerCase()).slice(0, 3),
      styles: (input.styles ?? []).slice(0, 2),
      rating: null, // column is nullable - user places start unrated
      priceLevel: null, // r25: was 2, rendered as a "$$" chip nobody asserted
      feeCents: null,
      feeCurrency: null,
      feeNote: null,
      description: input.description || null,
      hidden: false,
      image: null,
      source: "user",
      addedById: ctx.user.id,
      approved: false, // user submissions wait for admin validation
    });
    const [place] = await db
      .select()
      .from(schema.explorePlaces)
      .where(eq(schema.explorePlaces.id, Number(result[0].insertId)))
      .limit(1);
    return { conflict: false as const, place, pending: true as const };
  }),

  /** The caller's own submitted places, any approval state, newest first. */
  mySubmissions: authedQuery.query(async ({ ctx }) => {
    return getDb()
      .select()
      .from(schema.explorePlaces)
      .where(eq(schema.explorePlaces.addedById, ctx.user.id))
      .orderBy(desc(schema.explorePlaces.id));
  }),

  /**
   * "What's near me" - live Overpass `around:` search mapped onto the place
   * model. Each result is flagged when it already exists in the corpus (same
   * normalized name within 0.2 km). Overpass outages degrade to an empty,
   * flagged response - never a thrown error.
   */
  nearby: authedQuery
    .input(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radius: z.number().int().min(100).max(5000).optional(),
        kind: z.enum(["food", "activity", "all"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const radius = Math.min(input.radius ?? 1500, 5000);
      const kind = input.kind ?? "all";
      let elements: OverpassElement[];
      try {
        elements = await fetchNearby(input.lat, input.lng, radius, kind);
      } catch {
        return { results: [] as NearbyResult[], degraded: true as const };
      }

      // Corpus candidates for the inCorpus check - ~6.6 km bbox around the point
      const d = 0.06;
      const corpus = await getDb()
        .select({
          id: schema.explorePlaces.id,
          name: schema.explorePlaces.name,
          lat: schema.explorePlaces.lat,
          lng: schema.explorePlaces.lng,
        })
        .from(schema.explorePlaces)
        .where(
          and(
            placeVisibleTo(ctx.user.id),
            gte(schema.explorePlaces.lat, input.lat - d),
            lte(schema.explorePlaces.lat, input.lat + d),
            gte(schema.explorePlaces.lng, input.lng - d),
            lte(schema.explorePlaces.lng, input.lng + d),
          ),
        );

      const results: NearbyResult[] = [];
      for (const el of elements) {
        const tags = el.tags ?? {};
        const name = (tags.name ?? "").trim();
        if (!name) continue;
        if (isGenericName(name)) continue; // hide placeholder-named OSM rows from the suggestion list
        const elLat = el.type === "node" ? el.lat : el.center?.lat;
        const elLng = el.type === "node" ? el.lon : el.center?.lon;
        if (typeof elLat !== "number" || typeof elLng !== "number") continue;
        const nameKey = normalizePlaceName(name);
        // drop near-identical rows (same name within 0.2 km) inside the batch
        if (
          results.some(
            (r) =>
              normalizePlaceName(r.name) === nameKey &&
              kmBetween(r.lat, r.lng, elLat, elLng) <= 0.2,
          )
        ) {
          continue;
        }
        const match = corpus.find(
          (p) =>
            p.lat != null &&
            p.lng != null &&
            normalizePlaceName(p.name) === nameKey &&
            kmBetween(p.lat, p.lng, elLat, elLng) <= 0.2,
        );
        const address =
          [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]]
            .filter(Boolean)
            .join(", ") || undefined;
        results.push({
          name,
          lat: elLat,
          lng: elLng,
          category: NEARBY_FOOD_AMENITIES.has(tags.amenity ?? "") ? "food" : "activity",
          address,
          distanceM: Math.round(kmBetween(input.lat, input.lng, elLat, elLng) * 1000),
          osmId: `${el.type}/${el.id}`,
          inCorpus: match != null,
          placeId: match?.id ?? null,
        });
      }
      results.sort((a, b) => a.distanceM - b.distanceM);
      return { results: results.slice(0, 40), degraded: false as const };
    }),

  cities: authedQuery.query(async ({ ctx }) => {
    // r21-perf: aggregate in SQL instead of streaming SELECT * over the whole
    // corpus to Node (was ~20s inside the /explore tRPC batch). Image/country
    // are decorative per-city picks; ANY_VALUE matches the old first-row-wins
    // behavior.
    const rows = await getDb()
      .select({
        city: schema.explorePlaces.city,
        country: sql<string>`ANY_VALUE(${schema.explorePlaces.country})`,
        count: sql<number>`COUNT(*)`.mapWith(Number),
        image: sql<string | null>`ANY_VALUE(${schema.explorePlaces.image})`,
      })
      .from(schema.explorePlaces)
      .where(placeVisibleTo(ctx.user.id))
      .groupBy(schema.explorePlaces.city);
    return rows.sort((a, b) => b.count - a.count);
  }),

  /**
   * "Famous in {city}" (mission r11-quality) - the blog-style top-10 for a
   * city: approved corpus places with generic OSM placeholder names removed,
   * ranked by
   *   fame = rating weight × category iconicity (landmark/museum/viewpoint
   *          > restaurant) × curated world-famous boost (~270-entry list,
   *          fuzzy name+city match) × has-own-photo bonus
   * (see api/lib/place-quality.ts). Each pick carries a one-line
   * template-driven "why it's famous" blurb and a best-effort verdict -
   * the row's own verdict when set, else must-see for world-famous/top-3,
   * worth-it for 4–6.
   */
  famousInCity: authedQuery
    .input(
      z.object({
        city: z.string().trim().min(2).max(120),
        limit: z.number().int().min(1).max(25).optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const escaped = input.city.replace(/[\\%_]/g, (m) => `\\${m}`);
      // LIKE is only a cheap prefilter; the JS city check below is exact-ish.
      const rows = await db
        .select()
        .from(schema.explorePlaces)
        .where(
          and(
            eq(schema.explorePlaces.approved, true),
            like(schema.explorePlaces.city, `%${escaped}%`),
          ),
        );
      const cityKey = normalizeNameKey(input.city);
      const seen = new Set<string>();
      const seenEntries = new Set<string>();
      const ranked = rows
        .filter((p) => {
          const ck = normalizeNameKey(p.city);
          if (
            !(
              ck === cityKey ||
              ck.replace(/ /g, "") === cityKey.replace(/ /g, "") ||
              (cityKey.length >= 4 && ck.includes(cityKey)) ||
              (ck.length >= 4 && cityKey.includes(ck))
            )
          ) {
            return false;
          }
          if (isGenericName(p.name)) return false; // never famous: "Park", "Central Market", …
          const nk = normalizeNameKey(p.name);
          if (seen.has(nk)) return false;
          seen.add(nk);
          return true;
        })
        .map((p) => ({ ...p, ...fameScoreFor(p, p.city) }))
        .sort((a, b) => b.fame - a.fame || a.name.localeCompare(b.name))
        // Corpus duplicates ("Amer Fort" seed + "Amber Fort" OSM import)
        // resolve to the same curated entry - keep the higher-scored one.
        .filter((p) => {
          if (p.world == null) return true;
          if (seenEntries.has(p.world.n)) return false;
          seenEntries.add(p.world.n);
          return true;
        })
        .slice(0, input.limit ?? 10)
        .map((p, i) => ({
          ...p,
          rank: i + 1,
          fameScore: p.fame,
          worldFamous: p.world != null,
          verdict: p.verdict ?? (p.world != null || i < 3 ? "must-see" : i < 6 ? "worth-it" : null),
          blurb: blurbFor(p, input.city, p.world != null),
        }));
      return { city: input.city, places: ranked };
    }),

  /**
   * "★ Famous eats" (r15-eats) - the famous eateries of a city: food places
   * flagged famousEatery by the deterministic backfill (verdict='must-see'
   * OR top 8% by rating, min 4.3, cap 15/city - see api/lib/famous-eats.ts),
   * ranked by rating. When the city has none locally, falls back to the
   * nearest big corpus city (≥ 50 food places, else the biggest one) so the
   * rail can still offer "the famous picks near you". Public: the CityBuilder
   * rail renders for anonymous visitors too.
   */
  famousEats: publicQuery
    .input(
      z.object({
        city: z.string().trim().min(2).max(120),
        country: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(25).default(10),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const cityCond = (city: string, country?: string) =>
        and(
          eq(schema.explorePlaces.category, "food"),
          eq(schema.explorePlaces.approved, true),
          eq(schema.explorePlaces.famousEatery, true),
          eq(schema.explorePlaces.city, city),
          country ? eq(schema.explorePlaces.country, country) : undefined,
        );

      const local = await db
        .select()
        .from(schema.explorePlaces)
        .where(cityCond(input.city, input.country))
        .orderBy(desc(schema.explorePlaces.rating), schema.explorePlaces.id)
        .limit(input.limit);
      if (local.length) {
        return { city: input.city, country: input.country ?? local[0].country, places: local, fallback: null };
      }

      // ── Fallback: nearest big corpus city with famous eateries ──
      const originRows = await db
        .select({
          lat: sql<number>`avg(${schema.explorePlaces.lat})`.mapWith(Number),
          lng: sql<number>`avg(${schema.explorePlaces.lng})`.mapWith(Number),
        })
        .from(schema.explorePlaces)
        .where(
          and(
            eq(schema.explorePlaces.city, input.city),
            input.country ? eq(schema.explorePlaces.country, input.country) : undefined,
          ),
        );
      const origin = originRows[0];

      const candidates = await db
        .select({
          city: schema.explorePlaces.city,
          country: schema.explorePlaces.country,
          lat: sql<number>`avg(${schema.explorePlaces.lat})`.mapWith(Number),
          lng: sql<number>`avg(${schema.explorePlaces.lng})`.mapWith(Number),
          food: sql<number>`count(*)`.mapWith(Number),
          famous: sql<number>`sum(${schema.explorePlaces.famousEatery})`.mapWith(Number),
        })
        .from(schema.explorePlaces)
        .where(and(eq(schema.explorePlaces.category, "food"), eq(schema.explorePlaces.approved, true)))
        .groupBy(schema.explorePlaces.city, schema.explorePlaces.country);

      const nearest = pickFamousEatsFallback(
        candidates,
        input.city,
        origin?.lat != null && origin?.lng != null && Number.isFinite(origin.lat)
          ? { lat: origin.lat, lng: origin.lng }
          : null,
      );
      if (!nearest) return { city: input.city, country: input.country ?? null, places: [], fallback: null };

      const places = await db
        .select()
        .from(schema.explorePlaces)
        .where(cityCond(nearest.city, nearest.country))
        .orderBy(desc(schema.explorePlaces.rating), schema.explorePlaces.id)
        .limit(input.limit);
      return {
        city: input.city,
        country: input.country ?? nearest.country,
        places,
        fallback: { city: nearest.city, country: nearest.country },
      };
    }),

  /**
   * "Taste <city>" (r16-culinary) - the signature dishes of a city, each
   * mapped to the famous places that serve it (imported from
   * db/data/signature-dishes-*.json). Places join explore_places when the
   * importer linked them (rating / famousEatery / image come from the corpus
   * row). Empty array when the city has no curated dishes - the UI section
   * hides itself then. Public: renders for anonymous visitors too.
   */
  cityTastes: publicQuery
    .input(
      z.object({
        city: z.string().trim().min(2).max(120),
        country: z.string().trim().max(120).optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const dishes = await db
        .select()
        .from(schema.signatureDishes)
        .where(
          and(
            eq(schema.signatureDishes.city, input.city),
            input.country ? eq(schema.signatureDishes.country, input.country) : undefined,
          ),
        )
        .orderBy(schema.signatureDishes.position, schema.signatureDishes.id);
      if (!dishes.length) return [];

      const dishIds = dishes.map((d) => Number(d.id));
      const rows = await db
        .select({
          id: schema.signatureDishPlaces.id,
          dishId: schema.signatureDishPlaces.dishId,
          placeId: schema.signatureDishPlaces.placeId,
          name: schema.signatureDishPlaces.name,
          lat: schema.signatureDishPlaces.lat,
          lng: schema.signatureDishPlaces.lng,
          why: schema.signatureDishPlaces.why,
          position: schema.signatureDishPlaces.position,
          rating: schema.explorePlaces.rating,
          famousEatery: schema.explorePlaces.famousEatery,
          image: schema.explorePlaces.image,
        })
        .from(schema.signatureDishPlaces)
        .leftJoin(
          schema.explorePlaces,
          eq(schema.signatureDishPlaces.placeId, schema.explorePlaces.id),
        )
        .where(inArray(schema.signatureDishPlaces.dishId, dishIds))
        .orderBy(schema.signatureDishPlaces.position, schema.signatureDishPlaces.id);

      const byDish = new Map<number, typeof rows>();
      for (const r of rows) {
        const k = Number(r.dishId);
        if (!byDish.has(k)) byDish.set(k, []);
        byDish.get(k)!.push(r);
      }
      return dishes.map((d) => ({
        id: Number(d.id),
        city: d.city,
        country: d.country,
        dish: d.dish,
        blurb: d.blurb,
        places: (byDish.get(Number(d.id)) ?? []).map((p) => ({
          id: Number(p.id),
          placeId: p.placeId != null ? Number(p.placeId) : null,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          why: p.why,
          rating: p.rating ?? null,
          famousEatery: p.famousEatery ?? false,
          image: p.image ?? null,
        })),
      }));
    }),

  // ── Bucket list ──────────────────────────────────────────────────────────
  bucketList: authedQuery.query(async ({ ctx }) => {
    return getDb()
      .select()
      .from(schema.bucketList)
      .where(eq(schema.bucketList.userId, ctx.user.id))
      .orderBy(desc(schema.bucketList.createdAt));
  }),

  addBucket: authedQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        country: z.string().max(255).optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        image: z.string().max(512).optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await getDb().insert(schema.bucketList).values({
        userId: ctx.user.id,
        name: input.name,
        country: input.country ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        image: input.image ?? null,
        note: input.note ?? null,
      });
      return { id: Number(result[0].insertId) };
    }),

  removeBucket: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Was: delete by id alone, with ctx never read -- any signed-in user
      // could wipe every bucket-list row on the platform by iterating ids.
      await getDb()
        .delete(schema.bucketList)
        .where(and(eq(schema.bucketList.id, input.id), eq(schema.bucketList.userId, ctx.user.id)));
      return { ok: true };
    }),

  /**
   * "Attractions anywhere on the planet" - bbox discovery behind the map's
   * "Search this area" button. Works for any viewport on Earth (this is how
   * villages get covered): village-scale boxes pass through as-is, huge boxes
   * (> AREA_MAX_SPAN_DEG on either axis) are tightened to a ~0.5° box around
   * the center so Overpass stays fast, and the client is told via `tightened`
   * + `hint`. New places are imported into explore_places through the same
   * normalize/dedupe path as city discovery (osmId + normalized name within
   * the bbox; source 'osm', approved by default). Every named element found -
   * new or already in the corpus - is returned in `places` so the client can
   * render pins and an add-to-day panel in one round-trip.
   */
  discoverArea: authedQuery
    .input(
      z.object({
        south: z.number().min(-90).max(90),
        west: z.number().min(-180).max(180),
        north: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.south >= input.north || input.west >= input.east) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid map bounds" });
      }

      // Tighten oversized bboxes to a ~0.5° box around the center - Overpass
      // struggles with continental-scale regex unions, and the cap of 120
      // elements would scatter results anyway.
      let s = input.south;
      let w = input.west;
      let n = input.north;
      let e = input.east;
      const tightened = n - s > AREA_MAX_SPAN_DEG || e - w > AREA_MAX_SPAN_DEG;
      if (tightened) {
        const cLat = (s + n) / 2;
        const cLng = (w + e) / 2;
        const half = AREA_MAX_SPAN_DEG / 2;
        s = Math.max(-90, cLat - half);
        n = Math.min(90, cLat + half);
        w = Math.max(-180, cLng - half);
        e = Math.min(180, cLng + half);
      }

      let elements: OverpassElement[];
      try {
        elements = await fetchArea({ s, w, n, e });
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            err instanceof Error
              ? `Area search unavailable: ${err.message}`
              : "Area search unavailable right now",
        });
      }

      // Label imported rows with a real place name when we can get one - a
      // single reverse-geocode call at the bbox center (empty strings if it
      // fails; both columns are NOT NULL but tolerate "").
      const geo = await reverseGeocodePoint((s + n) / 2, (w + e) / 2);
      const city = geo?.city ?? "";
      const country = geo?.country ?? "";

      const db = getDb();
      // Corpus rows already inside the effective bbox drive dedupe and the
      // inCorpus flag on returned places.
      const existing = await db
        .select({
          id: schema.explorePlaces.id,
          name: schema.explorePlaces.name,
          osmId: schema.explorePlaces.osmId,
          lat: schema.explorePlaces.lat,
          lng: schema.explorePlaces.lng,
        })
        .from(schema.explorePlaces)
        .where(
          and(
            gte(schema.explorePlaces.lat, s),
            lte(schema.explorePlaces.lat, n),
            gte(schema.explorePlaces.lng, w),
            lte(schema.explorePlaces.lng, e),
          ),
        );
      const byOsmId = new Map(existing.filter((r) => r.osmId != null).map((r) => [r.osmId as string, r]));
      const byName = new Map(existing.map((r) => [normalizePlaceName(r.name), r]));

      interface AreaPlace {
        name: string;
        lat: number;
        lng: number;
        category: string;
        tags: string[];
        address?: string;
        osmId: string;
        inCorpus: boolean;
        placeId: number | null;
      }

      const places: AreaPlace[] = [];
      const rows: (typeof schema.explorePlaces.$inferInsert)[] = [];
      const batchOsmIds = new Set<string>();
      const batchNames = new Set<string>();
      for (const el of elements) {
        const row = normalizeElement(el, city, country);
        if (!row || row.lat == null || row.lng == null) continue;
        const osmId = row.osmId as string;
        const nameKey = normalizePlaceName(row.name);
        const match = byOsmId.get(osmId) ?? byName.get(nameKey);
        const address =
          [el.tags?.["addr:street"], el.tags?.["addr:housenumber"], el.tags?.["addr:city"]]
            .filter(Boolean)
            .join(", ") || undefined;
        // Placeholder-named elements stay in the corpus (import below) but
        // are hidden from the returned suggestion pins.
        if (!isGenericName(row.name))
          places.push({
            name: row.name,
            lat: row.lat,
            lng: row.lng,
            category: row.category,
            tags: row.tags ?? [],
            address,
            osmId,
            inCorpus: match != null || batchNames.has(nameKey) || batchOsmIds.has(osmId),
            placeId: match?.id ?? null,
          });
        if (match != null || batchOsmIds.has(osmId) || batchNames.has(nameKey)) continue;
        batchOsmIds.add(osmId);
        batchNames.add(nameKey);
        rows.push(row);
      }

      for (let i = 0; i < rows.length; i += 50) {
        await db.insert(schema.explorePlaces).values(rows.slice(i, i + 50));
      }
      const countRows = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.explorePlaces)
        .where(
          and(
            gte(schema.explorePlaces.lat, s),
            lte(schema.explorePlaces.lat, n),
            gte(schema.explorePlaces.lng, w),
            lte(schema.explorePlaces.lng, e),
          ),
        );
      return {
        inserted: rows.length,
        total: Number(countRows[0]?.n ?? 0),
        places,
        tightened,
        hint: tightened
          ? "That area was too large, searched around the map center instead. Zoom in to refine."
          : null,
      };
    }),

  /** Save an explore place into a trip itinerary. */
  addToTrip: authedQuery
    .input(
      z.object({
        placeId: z.number(),
        tripId: z.number(),
        dayId: z.number().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      // This procedure previously never destructured ctx at all: authedQuery
      // proved *someone* was logged in, then the handler inserted a stop into
      // whatever tripId was passed. requireEditor closes that.
      const { requireEditor } = await import("./trip-router");
      await requireEditor(input.tripId, ctx.user.id);
      if (input.dayId != null) {
        const [day] = await db
          .select({ id: schema.tripDays.id })
          .from(schema.tripDays)
          .where(and(eq(schema.tripDays.id, input.dayId), eq(schema.tripDays.tripId, input.tripId)))
          .limit(1);
        if (!day) throw new TRPCError({ code: "NOT_FOUND", message: "Day not found on this trip" });
      }
      const [place] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, input.placeId)).limit(1);
      if (!place) return { ok: false };
      const siblings = (await db.select().from(schema.stops).where(eq(schema.stops.tripId, input.tripId))).filter(
        (s) => s.dayId === input.dayId,
      );
      const position = siblings.length ? Math.max(...siblings.map((s) => s.position)) + 1 : 0;
      const result = await db.insert(schema.stops).values({
        tripId: input.tripId,
        dayId: input.dayId,
        name: place.name,
        category: place.category,
        address: `${place.city}, ${place.country}`,
        lat: place.lat,
        lng: place.lng,
        notes: place.description,
        image: place.image,
        famousEatery: place.famousEatery, // ★ Famous pick rides along to the itinerary chip
        position,
      });
      return { ok: true, stopId: Number(result[0].insertId) };
    }),

  /**
   * Price info for every stop of a trip, matched to explore_places (exact
   * normalized name first - preferring a same-city / ≤200 m hit - then a
   * name-related place within 200 m). Drives the stop-card price chips.
   */
  stopPrices: authedQuery
    .input(z.object({ tripId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireTripMembership(input.tripId, ctx.user.id);
      const stops = await getDb()
        .select()
        .from(schema.stops)
        .where(eq(schema.stops.tripId, input.tripId));
      return { prices: await matchPricesToStops(stops) };
    }),

  /**
   * Estimated ticket + food spend for one trip day - sums the day's stops
   * matched to explore_places prices. `known` counts stops with any price
   * data, `total` is the day's stop count. Currency is the most common among
   * matched places (a day is normally one city).
   */
  dayCostEstimate: authedQuery
    .input(z.object({ tripId: z.number(), dayId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireTripMembership(input.tripId, ctx.user.id);
      const stops = (
        await getDb()
          .select()
          .from(schema.stops)
          .where(eq(schema.stops.tripId, input.tripId))
      ).filter((s) => s.dayId === input.dayId);
      const prices = await matchPricesToStops(stops);
      let ticketsCents = 0;
      let foodCents = 0;
      let known = 0;
      const currencies = new Map<string, number>();
      for (const p of prices) {
        const cur = p.feeCurrency ?? null;
        if (p.category === "food") {
          if (p.mealCents != null) {
            foodCents += p.mealCents;
            known++;
            if (cur) currencies.set(cur, (currencies.get(cur) ?? 0) + 1);
          }
        } else if (p.feeCents != null) {
          ticketsCents += p.feeCents;
          known++;
          if (cur) currencies.set(cur, (currencies.get(cur) ?? 0) + 1);
        }
      }
      const currency =
        [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
      return { ticketsCents, foodCents, currency, known, total: stops.length };
    }),

  // ── r11-journal APPEND region: closures, nearby eats, place comments ──────

  /**
   * Crowdsourced closure report.
   *
   * r33 SECURITY: this used to write closedStatus straight onto the shared
   * place row for ANY signed-in user, unmoderated. The docstring claimed the
   * report was "logged for admin review"; the only sink was a console.log, and
   * no procedure anywhere resets the flag - recovery meant a manual DB edit.
   * Since guest accounts are free and unlimited (auth.guestLogin), a loop could
   * mark all 526,142 places closed and there was no way back. The `open` value
   * made it worse: a genuinely closed place could be quietly un-closed.
   *
   * Now a report from an ordinary user becomes a support ticket, which is what
   * "logged for admin review" was always supposed to mean. Only an admin's
   * report applies to the corpus directly.
   */
  reportClosed: authedQuery
    .input(
      z.object({
        placeId: z.number(),
        status: z.enum(["temporarily_closed", "permanently_closed", "open"]),
        note: z.string().trim().max(280).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [place] = await db
        .select({ id: schema.explorePlaces.id, name: schema.explorePlaces.name })
        .from(schema.explorePlaces)
        .where(eq(schema.explorePlaces.id, input.placeId))
        .limit(1);
      if (!place) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });

      const isAdmin = ctx.user.role === "admin";
      if (isAdmin) {
        await db
          .update(schema.explorePlaces)
          .set({ closedStatus: input.status })
          .where(eq(schema.explorePlaces.id, input.placeId));
      } else {
        await db.insert(schema.supportTickets).values({
          userId: ctx.user.id,
          category: "other",
          message: `Closure report: place ${input.placeId} (${place.name}) -> ${input.status}${input.note ? `. Note: ${input.note}` : ""}`,
        });
      }
      console.log(
        `[explore.reportClosed] user ${ctx.user.id} → place ${input.placeId} (${place.name}): ${input.status}${input.note ? `, ${input.note}` : ""}`,
      );
      // `applied` tells the client whether the corpus actually changed, so the
      // UI can thank the reporter without claiming a status that is only
      // pending review. Returning input.status unconditionally would have made
      // the badge lie to every non-admin reporter.
      return {
        ok: true as const,
        placeId: input.placeId,
        applied: isAdmin,
        closedStatus: input.status,
      };
    }),

  /**
   * "Where to eat nearby" - top 4 food places within ~600 m of a place,
   * best-rated first (distance breaks ties). Permanently closed places are
   * demoted out of the list; temporarily closed ones are returned with their
   * closedStatus so the client can badge them.
   */
  nearbyFood: authedQuery
    .input(
      z.object({
        placeId: z.number(),
        radiusM: z.number().int().min(100).max(2000).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [place] = await db
        .select()
        .from(schema.explorePlaces)
        .where(eq(schema.explorePlaces.id, input.placeId))
        .limit(1);
      if (!place || place.lat == null || place.lng == null) return { places: [] };
      const radiusM = Math.min(input.radiusM ?? 600, 2000);
      // degree buffer ~1.4× the radius; the haversine pass below is exact
      const d = (radiusM / 111_320) * 1.4;
      const rows = await db
        .select()
        .from(schema.explorePlaces)
        .where(
          and(
            placeVisibleTo(ctx.user.id),
            eq(schema.explorePlaces.category, "food"),
            or(
              ne(schema.explorePlaces.closedStatus, "permanently_closed"),
              isNull(schema.explorePlaces.closedStatus),
            ),
            gte(schema.explorePlaces.lat, place.lat - d),
            lte(schema.explorePlaces.lat, place.lat + d),
            gte(schema.explorePlaces.lng, place.lng - d),
            lte(schema.explorePlaces.lng, place.lng + d),
          ),
        );
      const places = rows
        .filter((r) => r.id !== place.id && r.lat != null && r.lng != null)
        .map((r) => ({
          ...r,
          distanceM: Math.round(kmBetween(place.lat!, place.lng!, r.lat!, r.lng!) * 1000),
        }))
        .filter((r) => r.distanceM <= radiusM)
        .sort((a, b) => (b.rating ?? 4) - (a.rating ?? 4) || a.distanceM - b.distanceM)
        .slice(0, 4);
      return { places };
    }),

  /**
   * Community comments on a place - newest first, capped at 50, with author
   * display names joined in. Public read; `mine` flags the caller's own
   * comments so the client can render delete affordances.
   */
  placeComments: publicQuery
    .input(z.object({ placeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.placeComments)
        .where(eq(schema.placeComments.placeId, input.placeId))
        .orderBy(desc(schema.placeComments.createdAt))
        .limit(50);
      if (!rows.length) return { comments: [] };
      const userIds = [...new Set(rows.map((c) => c.userId))];
      const users = await db.select().from(schema.users).where(inArray(schema.users.id, userIds));
      const byId = new Map(users.map((u) => [u.id, u]));
      return {
        comments: rows.map((c) => ({
          id: c.id,
          placeId: c.placeId,
          text: c.text,
          createdAt: c.createdAt,
          userId: c.userId,
          userName: byId.get(c.userId)?.name ?? "Traveler",
          userAvatar: byId.get(c.userId)?.avatar ?? null,
          mine: ctx.user != null && c.userId === ctx.user.id,
        })),
      };
    }),

  /** Post a comment on a place (signed-in users, 1–1000 chars). */
  addPlaceComment: authedQuery
    .input(
      z.object({
        placeId: z.number(),
        text: z.string().trim().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [place] = await db
        .select({ id: schema.explorePlaces.id })
        .from(schema.explorePlaces)
        .where(eq(schema.explorePlaces.id, input.placeId))
        .limit(1);
      if (!place) throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
      const result = await db.insert(schema.placeComments).values({
        placeId: input.placeId,
        userId: ctx.user.id,
        text: input.text,
      });
      const id = Number(result[0].insertId);
      const [comment] = await db
        .select()
        .from(schema.placeComments)
        .where(eq(schema.placeComments.id, id))
        .limit(1);
      return {
        comment: {
          id,
          placeId: input.placeId,
          text: input.text,
          createdAt: comment?.createdAt ?? new Date(),
          userId: ctx.user.id,
          userName: ctx.user.name ?? "Traveler",
          userAvatar: ctx.user.avatar ?? null,
          mine: true,
        },
      };
    }),

  /** Delete a comment - the author, or any admin. */
  deletePlaceComment: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [comment] = await db
        .select()
        .from(schema.placeComments)
        .where(eq(schema.placeComments.id, input.id))
        .limit(1);
      if (!comment) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found" });
      if (comment.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own comments" });
      }
      await db.delete(schema.placeComments).where(eq(schema.placeComments.id, input.id));
      return { ok: true as const };
    }),
});

/* ── Stop → explore_places price matching (stopPrices / dayCostEstimate) ── */

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

export interface StopPriceInfo {
  stopId: number;
  category: string;
  feeCents: number | null;
  feeCurrency: string | null;
  mealCents: number | null;
  /** true when the price comes from the modeled "Avg …" fill, not research */
  estimated: boolean;
}

/**
 * Match stops to explore_places for pricing. Two candidate fetches only:
 * exact normalized names (one IN query) and small geo boxes around each stop
 * (one OR'ed query per ≤30 stops). Matching is conservative - a stop with no
 * name-related place nearby simply gets no price rather than a wrong one.
 * (Exported for seed/verification scripts.)
 */
export async function matchPricesToStops(
  stops: schema.Stop[],
): Promise<StopPriceInfo[]> {
  if (!stops.length) return [];
  const db = getDb();

  const nameKeys = [...new Set(stops.map((s) => normalizePlaceName(s.name)))];
  const byName = await db
    .select()
    .from(schema.explorePlaces)
    .where(
      or(
        ...nameKeys.map((n) =>
          eq(sql`LOWER(TRIM(${schema.explorePlaces.name}))`, n),
        ),
      ),
    );

  const geoStops = stops.filter((s) => s.lat != null && s.lng != null);
  const byGeo: schema.ExplorePlace[] = [];
  for (let i = 0; i < geoStops.length; i += 30) {
    const chunk = geoStops.slice(i, i + 30);
    const rows = await db
      .select()
      .from(schema.explorePlaces)
      .where(
        or(
          ...chunk.map((s) =>
            and(
              gte(schema.explorePlaces.lat, s.lat! - 0.003),
              lte(schema.explorePlaces.lat, s.lat! + 0.003),
              gte(schema.explorePlaces.lng, s.lng! - 0.003),
              lte(schema.explorePlaces.lng, s.lng! + 0.003),
            ),
          ),
        ),
      );
    byGeo.push(...rows);
  }

  const kmTo = (p: schema.ExplorePlace, s: schema.Stop) =>
    p.lat != null && p.lng != null && s.lat != null && s.lng != null
      ? kmBetween(s.lat, s.lng, p.lat, p.lng)
      : Infinity;

  function pickPlace(stop: schema.Stop): schema.ExplorePlace | null {
    const n = normPlace(stop.name);
    const exact = byName.filter((p) => normPlace(p.name) === n);
    if (exact.length) {
      const near = exact
        .filter((p) => kmTo(p, stop) <= 0.2)
        .sort((a, b) => kmTo(a, stop) - kmTo(b, stop))[0];
      if (near) return near;
      // explore-added stops store "City, Country" in the address
      const addrN = normPlace(stop.address ?? "");
      const inCity = addrN
        ? exact.find((p) => addrN.startsWith(normPlace(p.city)))
        : undefined;
      if (inCity) return inCity;
      if (stop.lat == null || stop.lng == null) return exact[0]!;
    }
    if (stop.lat != null && stop.lng != null) {
      const named = byGeo
        .filter((p) => {
          if (kmTo(p, stop) > 0.2) return false;
          const pn = normPlace(p.name);
          return (
            pn === n ||
            (n.length >= 6 && pn.includes(n)) ||
            (pn.length >= 6 && n.includes(pn))
          );
        })
        .sort((a, b) => kmTo(a, stop) - kmTo(b, stop))[0];
      if (named) return named;
    }
    return exact[0] ?? null;
  }

  return stops.map((stop) => {
    const place = pickPlace(stop);
    return {
      stopId: stop.id,
      category: stop.category ?? place?.category ?? "activity",
      feeCents: place?.feeCents ?? null,
      feeCurrency: place?.feeCurrency ?? null,
      mealCents: place?.mealCents ?? null,
      estimated:
        (place?.feeNote ?? "").startsWith("Avg") ||
        (place?.mealNote ?? "").startsWith("Avg"),
    };
  });
}
