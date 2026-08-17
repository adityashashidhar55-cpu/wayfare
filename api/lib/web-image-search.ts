/**
 * api/lib/web-image-search.ts (r19-portal) — web image search for the owner
 * portal ("images need not be just from Wiki, can be google searched").
 *
 * Two sources, tried in order (8s timeout each), first non-empty wins:
 *
 *   1. Openverse (api.openverse.org) — openly licensed images; we request
 *      license_type=commercial and carry creator+license as attribution.
 *   2. DuckDuckGo images — scrape the `vqd` token from the html results page,
 *      then the i.js JSON endpoint; attribution is the image's host domain.
 *
 * Graceful-degradation contract (mirrors lib/osm-photo.ts): ANY failure of a
 * source (network blocked, timeout, non-JSON, empty results) falls through to
 * the next; when EVERY source fails the result is
 * `{ candidates: [], unavailable: true }` — never a thrown error. The portal
 * shows "image search unavailable from this server" in that case. Successful
 * (incl. legitimately empty) results are cached 24h in api_cache (`wimg:`).
 */

import { cacheGet, cacheKey, cacheSet } from "./cache";
import { fetchJson } from "./http";

const WIMG_UA = "Wayfare/1.0 (travel app; owner-portal image search; +https://wayfare.app)";
const TTL_24H = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;
const MAX_IMAGE_URL_LEN = 500;

export interface WebImageCandidate {
  url: string;
  thumb: string;
  title: string;
  source: "openverse" | "duckduckgo";
  license: string | null;
  attribution: string;
}

export interface WebImageSearchResult {
  candidates: WebImageCandidate[];
  /** True when every source failed (network blocked etc.) — NOT an error. */
  unavailable: boolean;
}

const normQuery = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const wimgCacheKey = (query: string, count: number) =>
  cacheKey("wimg:", `${normQuery(query)}|${count}`);

const okUrl = (u: unknown): u is string =>
  typeof u === "string" && /^https?:\/\//i.test(u) && u.length <= MAX_IMAGE_URL_LEN;

// ─── Openverse ───────────────────────────────────────────────────────────────

interface OpenverseResult {
  url?: string;
  thumbnail?: string;
  title?: string;
  license?: string;
  creator?: string;
}

async function searchOpenverse(query: string, count: number): Promise<WebImageCandidate[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", String(count));
  url.searchParams.set("license_type", "commercial");
  const data = await fetchJson<{ results?: OpenverseResult[] }>(url, {
    userAgent: WIMG_UA,
    service: "openverse",
    timeoutMs: TIMEOUT_MS,
  });
  const out: WebImageCandidate[] = [];
  for (const r of data.results ?? []) {
    if (!okUrl(r.url)) continue;
    const license = (r.license ?? "").trim().toUpperCase() || null;
    const attribution =
      [r.creator?.trim(), license].filter(Boolean).join(" · ") || "Openverse";
    out.push({
      url: r.url,
      thumb: okUrl(r.thumbnail) ? r.thumbnail : r.url,
      title: (r.title ?? "").trim().slice(0, 200),
      source: "openverse",
      license,
      attribution: attribution.slice(0, 255),
    });
    if (out.length >= count) break;
  }
  return out;
}

// ─── DuckDuckGo images ───────────────────────────────────────────────────────

/** The html results page embeds a `vqd` token the i.js endpoint requires. */
function extractVqd(html: string): string | null {
  const m = /vqd="([^"]+)"/.exec(html) ?? /vqd='([^']+)'/.exec(html) ?? /vqd=([\d-]+)&/.exec(html);
  return m?.[1] ?? null;
}

interface DdgResult {
  m?: string; // full image url
  t?: string; // title
  tb?: string; // base64 data-uri thumbnail
}

async function searchDuckDuckGo(query: string, count: number): Promise<WebImageCandidate[]> {
  // Step 1: the html page (raw fetch — it's not JSON, so fetchJson would refuse).
  const pageUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": WIMG_UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`duckduckgo html HTTP ${res.status}`);
  const vqd = extractVqd(await res.text());
  if (!vqd) throw new Error("duckduckgo vqd token not found");

  // Step 2: the JSON image endpoint.
  const ijs = new URL("https://duckduckgo.com/i.js");
  ijs.searchParams.set("l", "us-en");
  ijs.searchParams.set("o", "json");
  ijs.searchParams.set("q", query);
  ijs.searchParams.set("vqd", vqd);
  const data = await fetchJson<{ results?: DdgResult[] }>(ijs, {
    userAgent: WIMG_UA,
    service: "duckduckgo",
    timeoutMs: TIMEOUT_MS,
    headers: { Referer: "https://duckduckgo.com/" },
  });
  const out: WebImageCandidate[] = [];
  for (const r of data.results ?? []) {
    if (!okUrl(r.m)) continue;
    let host = "DuckDuckGo";
    try {
      host = new URL(r.m).hostname.replace(/^www\./, "");
    } catch {
      /* keep fallback */
    }
    out.push({
      url: r.m,
      thumb: r.tb && r.tb.startsWith("data:") ? r.tb : r.m,
      title: (r.t ?? "").trim().slice(0, 200),
      source: "duckduckgo",
      license: null,
      attribution: host.slice(0, 255),
    });
    if (out.length >= count) break;
  }
  return out;
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Uncached search: Openverse → DuckDuckGo, first non-empty source wins.
 * Never throws — total failure is `{ candidates: [], unavailable: true }`.
 * Exported for tests (mock fetch) and for callers that manage their own cache.
 */
export async function searchWebImagesUncached(
  query: string,
  count = 9,
): Promise<WebImageSearchResult> {
  const q = query.trim();
  const n = Math.max(1, Math.min(12, count));
  if (!q) return { candidates: [], unavailable: false };

  let sawFailure = false;
  for (const source of [searchOpenverse, searchDuckDuckGo]) {
    try {
      const candidates = await source(q, n);
      if (candidates.length) return { candidates, unavailable: false };
    } catch {
      sawFailure = true; // blocked/timeout/non-JSON → try the next source
    }
  }
  // Empty from every reachable source is a legit "no results"; only mark
  // unavailable when a source actually FAILED and nothing produced results.
  return { candidates: [], unavailable: sawFailure };
}

/**
 * Cached search (24h, `wimg:{query}|{count}`). Only definitive results are
 * cached — `unavailable` responses are re-tried next time.
 */
export async function searchWebImages(
  query: string,
  count = 9,
): Promise<WebImageSearchResult> {
  const key = wimgCacheKey(query, count);
  const cached = await cacheGet<WebImageSearchResult>(key);
  if (cached) return cached;
  const result = await searchWebImagesUncached(query, count);
  if (!result.unavailable) await cacheSet(key, result, TTL_24H);
  return result;
}
