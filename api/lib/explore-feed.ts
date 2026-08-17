/**
 * r22-speed: scored-feed engine for explore.list (global feed).
 *
 * The r21-perf round streamed the ENTIRE approved corpus (410k+ light rows)
 * into Node every 60s, scored every row in JS per request, then hydrated the
 * top 600. With corpus growth that was 13-20s per call and ~670MB RSS.
 *
 * This module instead computes the SAME ranking inside SQL: the score is an
 * exact SQL transcription of the JS scorer (style overlap + capped tag
 * overlap + rating + hidden-gem bonus + affordability + budget-free bonus -
 * statue penalty - style-mismatch penalty), so the database returns only the
 * top FEED_BUFFER rows, already ordered by (aboveBudget, roundedScore, id) -
 * the exact order the old pipeline produced (JS Array.sort is stable and the
 * corpus scan returns rows in id order). The buffer rows are then re-scored
 * in JS with the original scoring code (a 10x headroom guard against any
 * SQL/JS rounding nuance) and the top FEED_CAP survivors hydrated by id, so
 * the response shape is byte-identical to the old one.
 *
 * Tag/style matching uses LIKE '%"tag"%' substring predicates instead of
 * JSON_CONTAINS sums: corpus tags/styles are lowercase slug JSON arrays
 * (verified against the live corpus), so a quoted-slug substring match is
 * equivalent, and a string scan is ~3x cheaper than per-row JSON parsing.
 *
 * Results are cached process-wide per (userStyles, style, maxPrice) key with
 * single-flight fills and stale-while-revalidate, so warm hits skip SQL,
 * scoring AND hydration entirely, and no whole-corpus structure is retained.
 */
import { inArray, sql, type SQL } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { isStatueLike, styleMatchScore, tagsForStyles, STATUE_PENALTY } from "./style-map";
import { isGenericName } from "./place-quality";

/** Rows fetched from SQL per fill - 10x the shipped cap, absorbs the
 *  generic-name filter and any tie-order nuance at the cutoff. */
const FEED_BUFFER = 6000;
/** Places shipped to the client for the global feed (unchanged from r11). */
const FEED_CAP = 600;
/** Fresh TTL for a scored-feed entry. */
export const FEED_TTL_MS = 10 * 60 * 1000;
/** After expiry an entry stays servable (stale-while-revalidate) this long. */
const FEED_STALE_MS = 30 * 60 * 1000;
/** Bound on distinct cache keys held at once (each entry is ~600 rows). */
const FEED_CACHE_MAX = 32;

/** Corpus tag/style values are lowercase slugs; anything else can never
 *  match a corpus value, so the SQL term for it is a constant no-op. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface ExploreFeedKey {
  /** caller's preference styles (any order; normalized in feedCacheKey) */
  styles: string[];
  /** explore.list input.style hard filter, null when absent */
  style: string | null;
  /** budget ceiling derived from budgetBand + the "budget" style */
  maxPrice: number;
}

export function feedCacheKey(key: ExploreFeedKey): string {
  return `${[...key.styles].sort().join(",")}|${key.style ?? ""}|${key.maxPrice}`;
}

type ExplorePlaceColumn = (typeof schema.explorePlaces)[keyof typeof schema.explorePlaces];

/** `column LIKE '%"value"%'` as 0/1 (NULL-safe), bound as a parameter. */
function likeHas(column: SQL | ExplorePlaceColumn, value: string): SQL {
  return sql`COALESCE(${column} LIKE ${`%"${value}"%`}, 0)`;
}

/**
 * Exact SQL transcription of the JS ranking score (see explore-router list):
 *   styleOverlap*10 + min(tagHits,3)*4 + rating*2 + hidden*1.5
 *   + affordable*3 + (budget && feeCents==0)*2 - statue*3 - styleMismatch*100
 * Every term is NULL-safe so no row ever scores NULL (which would sink it
 * out of the buffer and break equivalence with the JS pipeline).
 */
export function feedScoreSql(userStyles: ReadonlySet<string>, inputStyle: string | null, maxPrice: number): SQL {
  const ep = schema.explorePlaces;
  const parts: SQL[] = [];
  for (const s of userStyles) {
    if (SLUG_RE.test(s)) parts.push(sql`10 * ${likeHas(ep.styles, s)}`);
  }
  const wanted = [...tagsForStyles(userStyles)].filter((t) => SLUG_RE.test(t));
  if (wanted.length) {
    parts.push(sql`4 * LEAST(3, ${sql.join(wanted.map((t) => likeHas(ep.tags, t)), sql` + `)})`);
  }
  // Statue name regex, equivalent to the JS /\b(statue|memorial|cenotaph|bust)\b/i
  // in style-map.ts. TiDB regexes are RE2: no [[:<:]] support, and a MySQL
  // string literal would eat "\b" as a backspace - so spell the boundary as
  // a non-word-char class instead (JS \b word chars are [A-Za-z0-9_]).
  const statue = sql`(${likeHas(ep.tags, "statue")} OR ${likeHas(ep.tags, "memorial")} OR ${likeHas(
    ep.tags,
    "artwork",
  )} OR ${ep.name} REGEXP '(^|[^A-Za-z0-9_])(statue|memorial|cenotaph|bust)([^A-Za-z0-9_]|$)')`;
  const terms: SQL[] = [
    ...(parts.length ? [sql`(${sql.join(parts, sql` + `)})`] : [sql`0`]),
    // Unrated rows now score 0 here instead of a phantom 4. Previously EVERY
    // OSM row carried a fabricated 4.3, so this term was a constant that
    // contributed nothing but looked like a quality signal. Curated rows with
    // a genuine rating now rank above unrated ones, which is the intent.
    // NOTE: must stay identical to the JS scorer below and in explore-router.
    sql`2 * COALESCE(${ep.rating}, 0)`,
    sql`1.5 * ${ep.hidden}`,
    sql`3 * (COALESCE(${ep.priceLevel}, 2) <= ${maxPrice})`,
  ];
  if (userStyles.has("budget")) terms.push(sql`2 * COALESCE((${ep.feeCents} = 0), 0)`);
  terms.push(sql`-3 * ${statue}`);
  if (inputStyle && SLUG_RE.test(inputStyle)) {
    terms.push(sql`-100 * (1 - ${likeHas(ep.styles, inputStyle)})`);
  }
  return sql.join(terms, sql` + `);
}

type LightScoredRow = {
  id: number;
  name: string;
  city: string;
  tags: string[] | null;
  styles: string[] | null;
  rating: number | null;
  hidden: number | boolean;
  priceLevel: number | null;
  feeCents: number | null;
};

/**
 * r22-speed payload trim: hydrate feed rows with only the columns the
 * explore clients render (PlaceCard / PlaceDetailDialog / AddPlaceOverlay /
 * JournalEditor). Dropped: styles (client uses server-computed matchStyles),
 * nameLocal, osmId, source, descriptionSource, photoSource, photoAttribution,
 * mealNote (admin/portal surfaces read those through other endpoints).
 */
export const FEED_COLUMNS = {
  id: schema.explorePlaces.id,
  name: schema.explorePlaces.name,
  city: schema.explorePlaces.city,
  country: schema.explorePlaces.country,
  lat: schema.explorePlaces.lat,
  lng: schema.explorePlaces.lng,
  category: schema.explorePlaces.category,
  tags: schema.explorePlaces.tags,
  rating: schema.explorePlaces.rating,
  priceLevel: schema.explorePlaces.priceLevel,
  feeCents: schema.explorePlaces.feeCents,
  feeCurrency: schema.explorePlaces.feeCurrency,
  feeNote: schema.explorePlaces.feeNote,
  mealCents: schema.explorePlaces.mealCents,
  image: schema.explorePlaces.image,
  description: schema.explorePlaces.description,
  hidden: schema.explorePlaces.hidden,
  verdict: schema.explorePlaces.verdict,
  closedStatus: schema.explorePlaces.closedStatus,
  famousEatery: schema.explorePlaces.famousEatery,
  addedById: schema.explorePlaces.addedById,
  approved: schema.explorePlaces.approved,
} as const;

export type FeedRow = Pick<
  schema.ExplorePlace,
  keyof typeof FEED_COLUMNS & keyof schema.ExplorePlace
>;

export type FeedPlace = FeedRow & {
  matchScore: number;
  matchStyles: string[];
  aboveBudget: boolean;
};

/** Score one light row with the ORIGINAL JS ranking code (kept in sync with
 *  explore-router by construction - both call the same helpers). */
function scoreLightRow(p: LightScoredRow, userStyles: ReadonlySet<string>, inputStyle: string | null, maxPrice: number) {
  const styles = p.styles ?? [];
  // `?? 0` (not `?? 4`) - must match feedScoreSql's COALESCE above, or the
  // SQL buffer and the JS re-score disagree and the equivalence guard breaks.
  let score = styleMatchScore(p, userStyles) + (p.rating ?? 0) * 2 + (p.hidden ? 1.5 : 0);
  if (isStatueLike(p)) score -= STATUE_PENALTY;
  const affordable = (p.priceLevel ?? 2) <= maxPrice;
  if (affordable) score += 3;
  if (userStyles.has("budget") && p.feeCents === 0) score += 2;
  if (inputStyle && !styles.includes(inputStyle)) score -= 100;
  return {
    matchScore: Math.round(score * 10) / 10,
    matchStyles: styles.filter((s) => userStyles.has(s)),
    aboveBudget: !affordable,
  };
}

/** The shared sort: unaffordable always last, then score desc. Stable. */
function feedSort(a: { matchScore: number; aboveBudget: boolean }, b: { matchScore: number; aboveBudget: boolean }) {
  if (a.aboveBudget !== b.aboveBudget) return a.aboveBudget ? 1 : -1;
  return b.matchScore - a.matchScore;
}

/**
 * Compute the global feed for one key: SQL scores and ranks the whole
 * approved corpus, Node re-scores only the buffer with the original code,
 * and the top FEED_CAP rows are hydrated with full columns by id.
 */
export async function computeGlobalFeed(key: ExploreFeedKey): Promise<FeedPlace[]> {
  const db = getDb();
  const ep = schema.explorePlaces;
  const userStyles = new Set(key.styles);
  const score = feedScoreSql(userStyles, key.style, key.maxPrice);
  const result = await db.execute(sql`
    SELECT ${ep.id}, ${ep.name}, ${ep.city}, ${ep.tags}, ${ep.styles},
           ${ep.rating}, ${ep.hidden}, ${ep.priceLevel}, ${ep.feeCents},
           ROUND(${score}, 1) AS rscore
    FROM ${ep}
    WHERE ${ep.approved} = true
    ORDER BY (COALESCE(${ep.priceLevel}, 2) > ${key.maxPrice}) ASC, rscore DESC, ${ep.id} ASC
    LIMIT ${FEED_BUFFER}
  `);
  const rows = result[0] as unknown as LightScoredRow[];
  const scored = rows
    .filter((p) => !isGenericName(p.name)) // hide OSM placeholder names from the suggestion feed
    .map((p) => ({ ...p, ...scoreLightRow(p, userStyles, key.style, key.maxPrice) }))
    .sort(feedSort)
    .slice(0, FEED_CAP);
  const ids = scored.map((p) => Number(p.id));
  const fullRows = ids.length ? await db.select(FEED_COLUMNS).from(ep).where(inArray(ep.id, ids)) : [];
  const byId = new Map(fullRows.map((r) => [Number(r.id), r]));
  return scored.flatMap((p) => {
    const full = byId.get(Number(p.id));
    // A row deleted between the two queries is dropped, not leaked partial.
    return full
      ? [{ ...full, matchScore: p.matchScore, matchStyles: p.matchStyles, aboveBudget: p.aboveBudget }]
      : [];
  });
}

// ── process-wide scored-feed cache (single-flight, stale-while-revalidate) ──

type FeedEntry = { rows: FeedPlace[]; key: ExploreFeedKey; expiresAt: number; staleAt: number };
const feedCache = new Map<string, FeedEntry>();
const feedFills = new Map<string, Promise<FeedPlace[]>>();

/** Injectable for tests - the real fill is computeGlobalFeed. */
let fillImpl: (key: ExploreFeedKey) => Promise<FeedPlace[]> = computeGlobalFeed;

function fillFeed(k: string, key: ExploreFeedKey): Promise<FeedPlace[]> {
  const existing = feedFills.get(k);
  if (existing) return existing;
  const p = fillImpl(key)
    .then((rows) => {
      if (feedCache.size >= FEED_CACHE_MAX && !feedCache.has(k)) {
        // Map iterates in insertion order - evict the oldest entry.
        const oldest = feedCache.keys().next().value;
        if (oldest !== undefined) feedCache.delete(oldest);
      }
      const now = Date.now();
      feedCache.set(k, { rows, key, expiresAt: now + FEED_TTL_MS, staleAt: now + FEED_STALE_MS });
      return rows;
    })
    .finally(() => {
      feedFills.delete(k);
    });
  feedFills.set(k, p);
  return p;
}

/** Feed rows for a key: fresh cache hit, stale hit + background refresh, or
 *  a blocking single-flight fill. */
export function getGlobalFeed(key: ExploreFeedKey): Promise<FeedPlace[]> {
  const k = feedCacheKey(key);
  const hit = feedCache.get(k);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return Promise.resolve(hit.rows);
  if (hit && hit.staleAt > now) {
    void fillFeed(k, key).catch((e) => console.warn("[explore-feed] background refresh failed:", e));
    return Promise.resolve(hit.rows);
  }
  return fillFeed(k, key);
}

/** Default guest-ish feed: no styles picked, mid budget, no style filter. */
const PREWARM_KEYS: ExploreFeedKey[] = [{ styles: [], style: null, maxPrice: 2 }];

/**
 * Pre-warm the default feed and keep active entries warm so real users
 * rarely hit a cold fill. Call once at server boot (production only - the
 * caller guards with env.isProduction, same pattern as boot.ts statics).
 */
export function prewarmExploreFeeds(): void {
  for (const key of PREWARM_KEYS) {
    void getGlobalFeed(key).catch((e) => console.warn("[explore-feed] prewarm failed:", e));
  }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of feedCache) {
      // Re-fill entries about to expire so the fresh window never lapses
      // for feeds users are actually asking for.
      if (entry.expiresAt - now < 60_000 && entry.staleAt > now) {
        void fillFeed(k, entry.key).catch((e) => console.warn("[explore-feed] re-warm failed:", e));
      }
    }
  }, 60_000);
  timer.unref(); // never keep a process alive just for the warmer
}

/** Test hooks - not for production use. */
export const __feedInternals = {
  cache: feedCache,
  fills: feedFills,
  setFillImpl(fn: ((key: ExploreFeedKey) => Promise<FeedPlace[]>) | null) {
    fillImpl = fn ?? computeGlobalFeed;
  },
  reset() {
    feedCache.clear();
    feedFills.clear();
    fillImpl = computeGlobalFeed;
  },
};
