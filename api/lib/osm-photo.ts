/**
 * r13-photos - capture REAL place photos from OSM tags at import time.
 *
 * Up to now every imported place got `image: NULL` and the renderer fell back
 * to the category×region stock pools (src/lib/place-images.ts) - generic and
 * often wrong for the actual place. OSM elements frequently carry a real
 * photo reference; this helper turns it into a directly usable URL:
 *
 *   1. `image=<url>`             - direct photo URL; used as-is, http(s) only
 *                                  (first value when `;`-separated).
 *   2. `wikimedia_commons=File:X.jpg`
 *                                - resolved through Commons' Special:FilePath
 *                                  at width=800 (server-side thumbnail).
 *      `wikimedia_commons=Category:X` - a whole category, not one photo: skip.
 *
 * The `wikidata` tag (e.g. "Q12345") is intentionally NOT stored yet - there
 * is no column for it; a later round can use it for a Wikidata image backfill.
 *
 * Shared by both importers: queries/overpass.ts (city import) and
 * queries/coverage.ts (deep coverage import).
 */

import { cacheGet, cacheKey, cacheSet } from "./cache";
import { fetchJson } from "./http";
import { normalizeNameKey } from "./place-quality";

/** explore_places.image is varchar(512) - keep a safety margin. */
const MAX_IMAGE_URL_LEN = 500;

/**
 * Return a real photo URL for the element's tags, or null when none is
 * usable (callers then leave image NULL → stock-pool fallback).
 */
export function osmImageFromTags(tags: Record<string, string>): string | null {
  const direct = tags.image?.split(";")[0]?.trim();
  if (direct && /^https?:\/\//i.test(direct) && direct.length <= MAX_IMAGE_URL_LEN) {
    return direct;
  }

  const commons = tags.wikimedia_commons?.trim();
  if (commons) {
    const fileMatch = /^File:(.+)$/i.exec(commons);
    if (fileMatch) {
      const filename = fileMatch[1]!.trim().replace(/ /g, "_");
      if (filename) {
        const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`;
        if (url.length <= MAX_IMAGE_URL_LEN) return url;
      }
    }
    // "Category:…" (or anything else) - not a single photo: skip.
  }

  return null;
}

// ─── r17-portal: single-place Wikipedia photo suggest ────────────────────────
// Extracted from db/seed-photos.ts (r13-photos) so the owner portal can ask
// "find a photo for THIS place" on demand. Same validation rules:
//   PRIMARY  Wikipedia REST search → title match (name ⊆ title or vice versa,
//            city token required for ≤2-word names) → page summary thumbnail
//            (≥640px preferred, else originalimage) → "Wikipedia" attribution.
//   FALLBACK DBpedia resource "{name}" / "{name}, {city}" resolved through
//            dbo:wikiPageRedirects → dbo:thumbnail, canonicalized to Commons
//            Special:FilePath (loads in browsers even where Wikimedia is
//            DNS-blocked); city-token pin in label/subjects for short names.
// Positive AND negative results cached 30d in api_cache (same key shape as
// the seeder, so portal suggests reuse seeder results and vice versa).

const WIKI_UA = "Wayfare/1.0 (travel app; place-photo suggest; +https://wayfare.app)";
const DBPEDIA_SPARQL = "https://dbpedia.org/sparql";
const TTL_30D = 30 * 24 * 60 * 60 * 1000;

export interface PhotoSuggestion {
  image: string;
  attribution: string;
  title: string;
  source: "wikipedia" | "dbpedia";
}
/** Cached value shape; image:null is the negative sentinel. */
type CachedSuggestion = { image: string | null; attribution?: string; title?: string };

const photoCacheKey = (name: string, city: string) =>
  cacheKey("wikiimg:", `${normalizeNameKey(name)}|${normalizeNameKey(city)}`);

/** City tokens (≥4 chars, minus administrative junk) present in a normalized haystack? */
function cityTokenIn(haystackKey: string, cityKey: string): boolean {
  const JUNK = new Set([
    "india", "municipal", "corporation", "city", "district", "state",
    "prefecture", "province", "county",
  ]);
  const tokens = cityKey.split(" ").filter((t) => t.length >= 4 && !JUNK.has(t));
  return tokens.length > 0 && tokens.some((t) => haystackKey.includes(t));
}

interface WikiSearchResponse {
  pages?: { title?: string; excerpt?: string; description?: string }[];
}
interface WikiSummary {
  thumbnail?: { source?: string; width?: number };
  originalimage?: { source?: string };
  license?: { text?: string };
  attribution?: { license?: string; text?: string };
}

async function lookupWikipedia(name: string, city: string): Promise<PhotoSuggestion | null> {
  const search = await fetchJson<WikiSearchResponse>(
    `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(`${name} ${city}`)}&limit=1`,
    { userAgent: WIKI_UA, service: "wikipedia", timeoutMs: 10000 },
  );
  const page = search.pages?.[0];
  if (!page?.title) return null;

  const nameKey = normalizeNameKey(name);
  const titleKey = normalizeNameKey(page.title);
  const contextKey = normalizeNameKey(
    `${(page.excerpt ?? "").replace(/<[^>]+>/g, " ")} ${page.description ?? ""}`,
  );
  if (nameKey.length < 4 || titleKey.length < 4) return null;
  if (!titleKey.includes(nameKey) && !nameKey.includes(titleKey)) return null;
  if (nameKey.split(" ").length <= 2 && !cityTokenIn(`${titleKey} ${contextKey}`, normalizeNameKey(city))) {
    return null;
  }

  const summary = await fetchJson<WikiSummary>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.title)}`,
    { userAgent: WIKI_UA, service: "wikipedia", timeoutMs: 10000 },
  );
  const thumb = summary.thumbnail;
  const orig = summary.originalimage;
  let image: string | null = null;
  if (thumb?.source && (thumb.width ?? 0) >= 640) image = thumb.source;
  else if (orig?.source) image = orig.source;
  else if (thumb?.source) image = thumb.source;
  if (!image || image.length > MAX_IMAGE_URL_LEN) return null;

  const attribution =
    summary.license?.text ?? summary.attribution?.license ?? summary.attribution?.text ?? "Wikipedia";
  return { image, attribution: attribution.slice(0, 255), title: page.title, source: "wikipedia" };
}

/** "Time Out Market" → http://dbpedia.org/resource/Time_Out_Market (raw non-ASCII kept). */
function dbpediaIri(title: string): string | null {
  const t = title.trim().replace(/\s+/g, "_");
  if (!t || /["<>{}|^`\\]/.test(t)) return null;
  const encoded = Array.from(t)
    .map((ch) => (/[A-Za-z0-9_\-.,'()!~&;=:@$*+]/.test(ch) || ch.charCodeAt(0) > 127 ? ch : encodeURIComponent(ch)))
    .join("");
  return `http://dbpedia.org/resource/${encoded}`;
}

interface SparqlBinding {
  label: { value: string };
  thumb: { value: string };
  subject?: { value: string };
}

async function lookupDbpedia(name: string, city: string): Promise<PhotoSuggestion | null> {
  const candidates = [dbpediaIri(name), dbpediaIri(`${name}, ${city}`)].filter(
    (c): c is string => Boolean(c),
  );
  if (!candidates.length) return null;
  const values = candidates.map((c) => `<${c}>`).join("\n    ");
  const query = `SELECT ?label ?thumb ?subject WHERE {
  VALUES ?start {
    ${values}
  }
  ?start <http://dbpedia.org/ontology/wikiPageRedirects>{0,1} ?target .
  ?target <http://dbpedia.org/ontology/thumbnail> ?thumb .
  ?target <http://www.w3.org/2000/01/rdf-schema#label> ?label .
  FILTER(lang(?label) = 'en')
  OPTIONAL { ?target <http://purl.org/dc/terms/subject> ?subject . }
}`;
  const url = `${DBPEDIA_SPARQL}?query=${encodeURIComponent(query)}&format=${encodeURIComponent("application/sparql-results+json")}`;
  const data = await fetchJson<{ results?: { bindings?: SparqlBinding[] } }>(url, {
    userAgent: WIKI_UA,
    service: "dbpedia",
    timeoutMs: 20000,
    headers: { Accept: "application/sparql-results+json" },
  });
  const bindings = data.results?.bindings ?? [];
  if (!bindings.length) return null;
  const label = bindings[0]!.label.value;
  const thumb = bindings[0]!.thumb.value;
  const subjects = bindings
    .map((b) => (b.subject?.value.split("/").pop() ?? "").replace(/_/g, " ").toLowerCase())
    .filter(Boolean)
    .join(" ");

  const nameKey = normalizeNameKey(name);
  const labelKey = normalizeNameKey(label);
  if (!labelKey.includes(nameKey) && !nameKey.includes(labelKey)) return null;
  if (nameKey.split(" ").length <= 2 && !cityTokenIn(`${labelKey} ${subjects}`, normalizeNameKey(city))) {
    return null;
  }

  // Canonicalize the thumbnail to a stable Commons FilePath URL.
  const file = /\/([^/]+\.(?:jpe?g|png|webp|gif))(?:\?|$)/i.exec(thumb)?.[1];
  const image = file
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=800`
    : thumb;
  if (image.length > MAX_IMAGE_URL_LEN) return null;
  return { image, attribution: "Wikimedia Commons", title: label, source: "dbpedia" };
}

/**
 * Suggest a real photo for one place (portal "Find on Wikipedia"). Returns
 * null when neither backend finds a validated match. Never writes to the DB -
 * the caller confirms via images.set.
 */
export async function suggestPlacePhoto(name: string, city: string): Promise<PhotoSuggestion | null> {
  const key = photoCacheKey(name, city);
  const cached = await cacheGet<CachedSuggestion>(key);
  if (cached) {
    return cached.image
      ? {
          image: cached.image,
          attribution: cached.attribution ?? "Wikipedia",
          title: cached.title ?? "",
          source: "wikipedia",
        }
      : null;
  }

  let hit: PhotoSuggestion | null = null;
  try {
    hit = await lookupWikipedia(name, city);
  } catch {
    hit = null; // Wikipedia unreachable (sandbox DNS) → DBpedia fallback
  }
  if (!hit) {
    try {
      hit = await lookupDbpedia(name, city);
    } catch {
      hit = null;
    }
  }

  await cacheSet(
    key,
    hit ? { image: hit.image, attribution: hit.attribution, title: hit.title } : { image: null },
    TTL_30D,
  );
  return hit;
}
