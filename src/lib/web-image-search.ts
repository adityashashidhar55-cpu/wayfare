/**
 * Client-side web image search (r20-links) for the owner portal "Find online"
 * flow. Openverse and Wikimedia Commons are both CORS-open, so the browser
 * queries them directly; the server endpoint (api/lib/web-image-search.ts,
 * Openverse -> DuckDuckGo) stays as the fallback for browsers whose network
 * blocks these APIs.
 *
 * Sources, queried in parallel:
 *
 *   1. Openverse (api.openverse.org) - openly licensed images, requested with
 *      license_type=commercial; creator + license carried for attribution.
 *   2. Wikimedia Commons (commons.wikimedia.org/w/api.php, origin=* is the
 *      CORS key) - File: search with imageinfo url + extmetadata (Artist,
 *      LicenseShortName); Artist HTML is stripped.
 *
 * Graceful-degradation contract: when BOTH sources fail the result is
 * `{ candidates: [], unavailable: true }` and the caller falls back to the
 * server endpoint; a single failed source just means fewer candidates.
 */

export interface WebImageHit {
  url: string;
  thumb: string;
  title: string;
  source: 'openverse' | 'wikimedia' | 'duckduckgo';
  /** Display label, e.g. "Openverse" / "Wikimedia Commons". */
  sourceLabel: string;
  license: string | null;
  creator: string | null;
  /** Page to credit / link back to (Openverse foreign_landing_url etc.). */
  landingUrl: string | null;
  /** "Creator · LICENSE" ready for the photoAttribution column. */
  attribution: string;
}

export interface WebImageSearchOutcome {
  candidates: WebImageHit[];
  /** True when BOTH client sources failed (caller falls back to the server). */
  unavailable: boolean;
}

const TIMEOUT_MS = 10_000;
const MAX_IMAGE_URL_LEN = 500;

const okUrl = (u: unknown): u is string =>
  typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= MAX_IMAGE_URL_LEN;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Strip HTML tags + common entities from Wikimedia extmetadata values. */
export function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchJsonClient(url: string | URL): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Openverse ───────────────────────────────────────────────────────────────

interface OpenverseItem {
  url?: unknown;
  thumbnail?: unknown;
  title?: unknown;
  license?: unknown;
  license_version?: unknown;
  creator?: unknown;
  foreign_landing_url?: unknown;
}

/** Map one Openverse result item; null when it has no usable image URL. */
export function mapOpenverseItem(item: OpenverseItem): WebImageHit | null {
  if (!okUrl(item.url)) return null;
  const creator = str(item.creator) || null;
  const licenseCode = str(item.license).toUpperCase();
  const license = licenseCode
    ? `${licenseCode}${str(item.license_version) ? ` ${str(item.license_version)}` : ''}`
    : null;
  return {
    url: item.url,
    thumb: okUrl(item.thumbnail) ? item.thumbnail : item.url,
    title: str(item.title).slice(0, 200),
    source: 'openverse',
    sourceLabel: 'Openverse',
    license,
    creator,
    landingUrl: okUrl(item.foreign_landing_url) ? item.foreign_landing_url : null,
    attribution: ([creator, license].filter(Boolean).join(' · ') || 'Openverse').slice(0, 255),
  };
}

export async function searchOpenverseClient(query: string, count: number): Promise<WebImageHit[]> {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', query);
  url.searchParams.set('page_size', String(count));
  url.searchParams.set('license_type', 'commercial');
  const data = (await fetchJsonClient(url)) as { results?: OpenverseItem[] };
  const out: WebImageHit[] = [];
  for (const item of data.results ?? []) {
    const hit = mapOpenverseItem(item);
    if (hit) out.push(hit);
    if (out.length >= count) break;
  }
  return out;
}

// ─── Wikimedia Commons ───────────────────────────────────────────────────────

interface CommonsPage {
  title?: unknown;
  imageinfo?: {
    url?: unknown;
    thumburl?: unknown;
    descriptionurl?: unknown;
    extmetadata?: {
      Artist?: { value?: unknown };
      LicenseShortName?: { value?: unknown };
    };
  }[];
}

/** Map one Commons File: page; null when it has no usable image URL. */
export function mapCommonsPage(page: CommonsPage): WebImageHit | null {
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined;
  if (!info || !okUrl(info.url)) return null;
  const creator = stripHtml(str(info.extmetadata?.Artist?.value)) || null;
  const license = stripHtml(str(info.extmetadata?.LicenseShortName?.value)) || null;
  const title = stripHtml(str(page.title).replace(/^File:/, ''));
  return {
    url: info.url,
    thumb: okUrl(info.thumburl) ? info.thumburl : info.url,
    title: title.slice(0, 200),
    source: 'wikimedia',
    sourceLabel: 'Wikimedia Commons',
    license,
    creator,
    landingUrl: okUrl(info.descriptionurl) ? info.descriptionurl : null,
    attribution: ([creator, license].filter(Boolean).join(' · ') || 'Wikimedia Commons').slice(0, 255),
  };
}

export async function searchWikimediaClient(query: string, count: number): Promise<WebImageHit[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*'); // required for CORS
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrnamespace', '6'); // File:
  url.searchParams.set('gsrlimit', String(count));
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata');
  url.searchParams.set('iiurlwidth', '400');
  const data = (await fetchJsonClient(url)) as { query?: { pages?: Record<string, CommonsPage> } };
  const out: WebImageHit[] = [];
  for (const page of Object.values(data.query?.pages ?? {})) {
    const hit = mapCommonsPage(page);
    if (hit) out.push(hit);
    if (out.length >= count) break;
  }
  return out;
}

// ─── merge + public API ──────────────────────────────────────────────────────

/**
 * Round-robin merge of per-source lists (variety over source blocks), deduped
 * by image URL, capped at `max`.
 */
export function mergeImageHits(lists: WebImageHit[][], max: number): WebImageHit[] {
  const seen = new Set<string>();
  const out: WebImageHit[] = [];
  let i = 0;
  while (out.length < max) {
    let progressed = false;
    for (const list of lists) {
      const hit = list[i];
      if (!hit) continue;
      progressed = true;
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      out.push(hit);
      if (out.length >= max) break;
    }
    if (!progressed) break;
    i++;
  }
  return out;
}

/**
 * Search Openverse + Wikimedia Commons in parallel from the browser. Never
 * throws: both sources failing is `{ candidates: [], unavailable: true }` so
 * the caller can fall back to the server-side search.
 */
export async function searchWebImagesClient(query: string, count = 12): Promise<WebImageSearchOutcome> {
  const q = query.trim();
  const n = Math.max(1, Math.min(12, count));
  if (!q) return { candidates: [], unavailable: false };
  const [ov, wm] = await Promise.allSettled([searchOpenverseClient(q, n), searchWikimediaClient(q, n)]);
  const lists: WebImageHit[][] = [];
  if (ov.status === 'fulfilled') lists.push(ov.value);
  if (wm.status === 'fulfilled') lists.push(wm.value);
  if (ov.status === 'rejected' && wm.status === 'rejected') {
    return { candidates: [], unavailable: true };
  }
  return { candidates: mergeImageHits(lists, n), unavailable: false };
}
