// api/lib/cache.ts - Persistent server-side cache for every external API
// call (Photon, Overpass, Open-Meteo, State Dept RSS, GDACS, ReliefWeb).
//
// Two tiers:
//   L1 - tiny in-process memo (keeps hot reads sub-millisecond; a remote DB
//        round-trip alone costs ~80 ms, which would defeat "instant" repeat
//        calls within one server process).
//   L2 - the `api_cache` MySQL/TiDB table { k PK, v mediumtext, expiresAt,
//        createdAt }, shared across processes and restarts.
//
// Fail-open contract: ANY cache-layer error (DB down, bad JSON, schema drift)
// is swallowed and treated as a cache miss - the caller always falls through
// to the real fetch. The cache must never break a request path.
//
// Key namespaces in use across the app:
//   geo:     Photon geocode / place search / reverse + Overpass responses
//   osrm:    road-trip routing (roadtrip-router may adopt these helpers)
//   wx:      Open-Meteo forecast (6h) + climate normals (7d)
//   adv:     US State Dept feed + aggregated travel guidance
//   gdacs:   GDACS disaster RSS
//   rw:      ReliefWeb (WHO) health notices
//   transit: transit feeds (roadtrip-router)
//   cityprof: city-builder cityProfile payloads

import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";

/** Max length of the api_cache.k primary key (varchar 191). */
const KEY_MAX = 191;
/** L1 memo entry cap - oldest-inserted entries are evicted past this. */
const L1_MAX = 500;
/** Probability of an opportunistic expired-row sweep on each cacheSet (~1/50). */
const SWEEP_ON_SET = 1 / 50;

type L1Entry = { exp: number; v: unknown };
const l1 = new Map<string, L1Entry>();

function l1Get<T>(k: string): T | null {
  const hit = l1.get(k);
  if (!hit) return null;
  if (hit.exp <= Date.now()) {
    l1.delete(k);
    return null;
  }
  return hit.v as T;
}

function l1Set(k: string, v: unknown, ttlMs: number): void {
  if (l1.size >= L1_MAX && !l1.has(k)) {
    // Map iterates in insertion order - evict the oldest entry.
    const oldest = l1.keys().next().value;
    if (oldest !== undefined) l1.delete(oldest);
  }
  l1.set(k, { exp: Date.now() + ttlMs, v });
}

function l1Del(k: string): void {
  l1.delete(k);
}

/** Stable hash for cache keys (query bodies, long queries). */
export function cacheHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 40);
}

/**
 * Build a cache key that always fits the varchar(191) PK - hashes the raw
 * portion when the combined key would be too long.
 */
export function cacheKey(prefix: string, raw: string): string {
  const key = `${prefix}${raw}`;
  return key.length <= KEY_MAX ? key : `${prefix}h:${cacheHash(raw)}`;
}

/**
 * Read a value from the cache. Expired rows are a miss (and lazily deleted).
 * Returns null on any failure - callers treat that as "not cached".
 */
export async function cacheGet<T>(k: string): Promise<T | null> {
  const memo = l1Get<T>(k);
  if (memo !== null) return memo;
  try {
    const rows = await getDb()
      .select({ v: schema.apiCache.v, expiresAt: schema.apiCache.expiresAt })
      .from(schema.apiCache)
      .where(eq(schema.apiCache.k, k))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const expMs =
      row.expiresAt instanceof Date
        ? row.expiresAt.getTime()
        : new Date(String(row.expiresAt)).getTime();
    const remaining = expMs - Date.now();
    if (remaining <= 0) {
      // Lazy delete of the expired row (fire-and-forget, fail-open).
      void getDb()
        .delete(schema.apiCache)
        .where(eq(schema.apiCache.k, k))
        .catch(() => {});
      return null;
    }
    const value = JSON.parse(row.v) as T;
    l1Set(k, value, remaining);
    return value;
  } catch {
    return null;
  }
}

/** Write a value with a TTL. Never throws - failures are silently ignored. */
export async function cacheSet(k: string, v: unknown, ttlMs: number): Promise<void> {
  l1Set(k, v, ttlMs);
  try {
    const body = JSON.stringify(v);
    const expiresAt = new Date(Date.now() + ttlMs);
    await getDb()
      .insert(schema.apiCache)
      .values({ k, v: body, expiresAt })
      .onDuplicateKeyUpdate({ set: { v: body, expiresAt } });
    if (Math.random() < SWEEP_ON_SET) void cacheSweep();
  } catch {
    /* fail-open: a cache write failure must not break the caller */
  }
}

/** Delete one key (both tiers). Never throws. */
export async function cacheDel(k: string): Promise<void> {
  l1Del(k);
  try {
    await getDb().delete(schema.apiCache).where(eq(schema.apiCache.k, k));
  } catch {
    /* fail-open */
  }
}

/**
 * Read-through helper: return the cached value for `k`, or run `fetcher`,
 * cache its result, and return it. null/undefined fetcher results are NOT
 * cached (callers that need negative caching should store a sentinel via
 * cacheSet themselves). The fetcher is always allowed to throw - its error
 * propagates to the caller exactly as if no cache existed.
 */
export async function cachedJson<T>(
  k: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(k);
  if (hit !== null) return hit;
  const value = await fetcher();
  if (value !== null && value !== undefined) await cacheSet(k, value, ttlMs);
  return value;
}

/**
 * Delete every expired row. Called opportunistically from cacheSet (~1/50)
 * so the table stays small without a separate cron. Returns the number of
 * rows removed (0 when the DB is unreachable).
 */
export async function cacheSweep(): Promise<number> {
  try {
    const res = await getDb()
      .delete(schema.apiCache)
      .where(lt(schema.apiCache.expiresAt, new Date()));
    const header = Array.isArray(res) ? res[0] : res;
    return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
  } catch {
    return 0;
  }
}

/** Count of live (unexpired) rows per key namespace - used by verify scripts. */
export async function cacheStats(): Promise<Record<string, number>> {
  try {
    const rows = await getDb()
      .select({ k: schema.apiCache.k, expiresAt: schema.apiCache.expiresAt })
      .from(schema.apiCache);
    const now = Date.now();
    const stats: Record<string, number> = {};
    for (const r of rows) {
      const expMs =
        r.expiresAt instanceof Date
          ? r.expiresAt.getTime()
          : new Date(String(r.expiresAt)).getTime();
      if (expMs <= now) continue;
      const ns = r.k.includes(":") ? r.k.slice(0, r.k.indexOf(":") + 1) : "(other)";
      stats[ns] = (stats[ns] ?? 0) + 1;
    }
    return stats;
  } catch {
    return {};
  }
}
