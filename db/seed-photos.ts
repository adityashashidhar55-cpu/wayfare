/**
 * seed-photos.ts (r13-photos) - backfill REAL place photos from Wikipedia.
 *
 * Place photos previously came from the category×region stock pools in
 * src/lib/place-images.ts - generic and often wrong for the actual place.
 * The renderer already prefers explore_places.image when set, so filling
 * `image` with real photos fixes the wrong-photo problem end to end.
 *
 * For every targeted explore_places row needing a photo - image IS NULL or
 * a shared local stock placeholder ("/place-temple.jpg" etc.) - with a
 * non-generic name (isGenericName, api/lib/place-quality.ts):
 *
 *   PRIMARY - Wikipedia REST (per place):
 *   1. Search:  GET /w/rest.php/v1/search/page?q=<name> <city>&limit=1
 *   2. Fuzzy title validation (same spirit as geocodeCityInCountry):
 *      normalized title must contain the normalized name (or vice versa,
 *      min 4 chars); when the name is ≤2 words a city token must also
 *      appear in the result title/excerpt (guards against same-name
 *      places elsewhere).
 *   3. Page summary:  GET /api/rest_v1/page/summary/<title>
 *      → thumbnail.source, preferring width>=640 (originalimage when the
 *      thumb is smaller); photoAttribution from license/attribution fields
 *      when present, else "Wikipedia".
 *
 *   FALLBACK - DBpedia SPARQL (batched, ~20 places/query), used only when
 *   en.wikipedia.org is unreachable from this network (sandboxed networks
 *   DNS-poison/block wikimedia.org - same situation db/seed-images.ts was
 *   built for). Candidate resources "{name}" and "{name}, {city}" are
 *   resolved through dbo:wikiPageRedirects (Wikipedia's own redirect
 *   graph, e.g. "Qutub Minar" → "Qutb Minar") to dbo:thumbnail; a resolved
 *   name-derived resource IS the name match. For ≤2-word names a city
 *   token must appear in the article label or dct:subject categories - 
 *   otherwise "Central Park (Varanasi)" would inherit New York's photo.
 *   Thumbnails are canonicalized to
 *   commons.wikimedia.org/wiki/Special:FilePath/<file>?width=800
 *   (attribution "Wikimedia Commons"). The stored URLs load in end users'
 *   browsers even when this sandbox can't reach Wikimedia.
 *
 * Both modes UPDATE image, photoSource='wikipedia', photoAttribution.
 *
 * Politeness & robustness:
 *   - ~300ms throttle (per place in Wikipedia mode, per 20-place batch in
 *     DBpedia mode), batches of 20.
 *   - Positive AND negative results cached 30d in api_cache
 *     (`wikiimg:{normalized name|city}`).
 *   - Checkpoint in api_cache (`seed:photos:checkpoint`) - if the sandbox
 *     kills the run, restart and it resumes; pass --restart to ignore the
 *     checkpoint and re-walk every image-less row (cached, so still fast).
 *   - Idempotent: rows already holding an external (http) image are never
 *     touched.
 *
 * Target set (r13 mission): verdict='must-see', top 1500 by rating, ALL
 * Bengaluru rows, plus Jaipur/Kyoto/Tokyo/Delhi/Mumbai rows.
 *
 * Also adopts legacy images: rows whose image already points at Wikimedia
 * (seed-images.ts round) but still have photoSource NULL get
 * photoSource='wikipedia' so coverage stats are truthful.
 *
 * r16-india: --country <name> restricts the target set to one country and
 * orders it by editorial priority - verdict='must-see' first, then
 * famousEatery, then getaway rows (tags hike|waterfall|viewpoint), then
 * top-rated - so a time-boxed run fixes the highest-value rows first. In
 * country mode the id-checkpoint is skipped: processed rows leave the
 * target set (image set) or are negatively cached 30d, so a fresh run
 * re-walks the remainder cheaply.
 *
 * Run:  npx tsx db/seed-photos.ts [--restart] [--country India]
 */
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheKey, cacheSet } from "../api/lib/cache";
import { fetchJson } from "../api/lib/http";
import { isGenericName, normalizeNameKey } from "../api/lib/place-quality";

const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 300; // polite: Wikipedia REST allows far more, no need to push it
const BATCH = 20;
const MAX_IMAGE_URL_LEN = 500; // explore_places.image is varchar(512)
const CHECKPOINT_KEY = "seed:photos:checkpoint";
const RESTART = process.argv.includes("--restart");
/** r16-india: --country India → all image-less rows of one country, priority order. */
const COUNTRY = (() => {
  const i = process.argv.indexOf("--country");
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
})();
const USER_AGENT = "Wayfare/1.0 (travel app; place-photo backfill; +https://wayfare.app)";
const DBPEDIA_SPARQL = "https://dbpedia.org/sparql";

/**
 * r13 target cities - matched as LOWER(city) substrings because the corpus
 * stores values like "Jaipur Municipal Corporation" and "Kolkata, India".
 * "delhi" covers "New Delhi"; "bengaluru"/"bangalore" are both listed.
 */
const TARGET_CITY_SUBSTRINGS = [
  "bengaluru",
  "bangalore",
  "jaipur",
  "kyoto",
  "tokyo",
  "delhi",
  "mumbai",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** dct:subject markers of articles that are NOT places (normalized form). */
const NON_PLACE_SUBJECT = /\d{4} (births|deaths)|\b(films|albums|songs|novels|television)\b/;

// ─── shared types ────────────────────────────────────────────────────────────

export interface PhotoHit {
  image: string;
  attribution: string;
  title: string;
}
/** Cached value shape; image:null is the negative (no Wikipedia photo) sentinel. */
type CachedPhoto = { image: string | null; attribution?: string; title?: string };

type PlaceRow = { id: number | bigint; name: string; city: string };

const photoCacheKey = (name: string, city: string) =>
  cacheKey("wikiimg:", `${normalizeNameKey(name)}|${normalizeNameKey(city)}`);

/**
 * City tokens (≥4 chars) found in an already-normalized haystack? Country-ish
 * and administrative junk tokens in the corpus' city field ("Kochi, India",
 * "Jaipur Municipal Corporation") are excluded - "india" must not pin a
 * Kochi restaurant to the Agra Taj Mahal article.
 */
function cityTokenIn(haystackKey: string, cityKey: string): boolean {
  const JUNK = new Set([
    "india", "municipal", "corporation", "city", "district", "state",
    "prefecture", "province", "county",
  ]);
  const tokens = cityKey.split(" ").filter((t) => t.length >= 4 && !JUNK.has(t));
  return tokens.length > 0 && tokens.some((t) => haystackKey.includes(t));
}

// ─── Wikipedia REST backend (primary) ────────────────────────────────────────

interface WikiSearchPage {
  title?: string;
  excerpt?: string; // HTML with <span class="searchmatch">
  description?: string;
}
interface WikiSearchResponse {
  pages?: WikiSearchPage[];
}
interface WikiImage {
  source?: string;
  width?: number;
  height?: number;
}
interface WikiSummary {
  thumbnail?: WikiImage;
  originalimage?: WikiImage;
  // license/attribution fields when the API includes them (usually absent)
  license?: { text?: string };
  attribution?: { license?: string; text?: string };
}

/**
 * True when the Wikipedia result plausibly IS the place: normalized title
 * contains the normalized name (or vice versa), both ≥4 chars. For short
 * names (≤2 words) a city token must also appear in the title or search
 * context - "Amber Fort" alone could be anywhere, "…Jaipur…" pins it.
 */
export function titleMatchesPlace(
  nameKey: string,
  titleKey: string,
  contextKey: string,
  cityKey: string,
): boolean {
  if (nameKey.length < 4 || titleKey.length < 4) return false;
  if (!titleKey.includes(nameKey) && !nameKey.includes(titleKey)) return false;
  const nameWords = nameKey.split(" ").length;
  if (nameWords <= 2) {
    const haystack = `${titleKey} ${contextKey}`;
    if (!cityTokenIn(haystack, cityKey)) return false;
  }
  return true;
}

async function lookupWikipediaPhoto(name: string, city: string): Promise<PhotoHit | null> {
  const searchUrl = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(
    `${name} ${city}`,
  )}&limit=1`;
  const search = await fetchJson<WikiSearchResponse>(searchUrl, {
    userAgent: USER_AGENT,
    service: "wikipedia",
    timeoutMs: 10000,
  });
  const page = search.pages?.[0];
  if (!page?.title) return null;

  const nameKey = normalizeNameKey(name);
  const titleKey = normalizeNameKey(page.title);
  const contextKey = normalizeNameKey(
    `${(page.excerpt ?? "").replace(/<[^>]+>/g, " ")} ${page.description ?? ""}`,
  );
  if (!titleMatchesPlace(nameKey, titleKey, contextKey, normalizeNameKey(city))) return null;

  const summary = await fetchJson<WikiSummary>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.title)}`,
    { userAgent: USER_AGENT, service: "wikipedia", timeoutMs: 10000 },
  );
  const thumb = summary.thumbnail;
  const orig = summary.originalimage;
  // Prefer a ≥640px thumbnail; when the thumb is small, the original image
  // is usually sharper. No thumb at all → original; tiny thumb & no
  // original → the small thumb is still better than a stock photo.
  let image: string | null = null;
  if (thumb?.source && (thumb.width ?? 0) >= 640) image = thumb.source;
  else if (orig?.source) image = orig.source;
  else if (thumb?.source) image = thumb.source;
  if (!image || image.length > MAX_IMAGE_URL_LEN) return null;

  const attribution =
    summary.license?.text ?? summary.attribution?.license ?? summary.attribution?.text ?? "Wikipedia";
  return { image, attribution: attribution.slice(0, 255), title: page.title };
}

/** One probe to decide whether the Wikipedia REST API is reachable at all. */
export async function wikipediaReachable(): Promise<boolean> {
  try {
    await fetchJson("https://en.wikipedia.org/w/rest.php/v1/search/page?q=wayfare&limit=1", {
      userAgent: USER_AGENT,
      service: "wikipedia",
      timeoutMs: 6000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Wikipedia mode, per place, with 30d positive+negative caching. */
export async function wikiPhotoForPlace(
  name: string,
  city: string,
): Promise<{ hit: PhotoHit | null; fromCache: boolean }> {
  const key = photoCacheKey(name, city);
  const cached = await cacheGet<CachedPhoto>(key);
  if (cached) {
    return {
      hit: cached.image
        ? { image: cached.image, attribution: cached.attribution ?? "Wikipedia", title: cached.title ?? "" }
        : null,
      fromCache: true,
    };
  }
  const hit = await lookupWikipediaPhoto(name, city);
  await cacheSet(
    key,
    hit ? { image: hit.image, attribution: hit.attribution, title: hit.title } : { image: null },
    TTL_30D,
  );
  return { hit, fromCache: false };
}

// ─── DBpedia SPARQL backend (fallback; batched) ──────────────────────────────

/** "Time Out Market" → http://dbpedia.org/resource/Time_Out_Market */
function dbpediaIri(title: string): string | null {
  const t = title.trim().replace(/\s+/g, "_");
  if (!t || /["<>{}|^`\\]/.test(t)) return null; // illegal inside SPARQL IRIREF
  // r16-france: keep non-ASCII letters RAW (é, œ, ç…). Percent-encoding them
  // (%C3%A9) made Virtuoso fail to join the resource IRI, so accented places
  // (Musée d'Orsay, Sacré-Cœur) never resolved a thumbnail. The whole SPARQL
  // query is URL-encoded at transport time, so raw UTF-8 in the IRI is safe.
  const encoded = Array.from(t)
    .map((ch) => (/[A-Za-z0-9_\-.,'()!~&;=:@$*+]/.test(ch) || ch.charCodeAt(0) > 127 ? ch : encodeURIComponent(ch)))
    .join("");
  return `http://dbpedia.org/resource/${encoded}`;
}

interface SparqlBinding {
  start: { value: string };
  label: { value: string };
  thumb: { value: string };
  subject?: { value: string };
}

interface DbpediaResult {
  label: string;
  thumb: string;
  /** dct:subject category tails, e.g. "tourist attractions in agra" - the
   * city-pin evidence (this DBpedia endpoint carries no dbo:abstract). */
  subjects: string[];
}

/**
 * Batched lookup: candidate IRIs → thumbnail + English label + dct:subject
 * categories of the (redirect-resolved) target resource. One VALUES +
 * property-path query handles ~20 places at a time.
 */
async function fetchDbpediaThumbs(candidates: string[]): Promise<Map<string, DbpediaResult>> {
  const values = candidates.map((c) => `<${c}>`).join("\n    ");
  const query = `SELECT ?start ?label ?thumb ?subject WHERE {
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
    userAgent: USER_AGENT,
    service: "dbpedia",
    timeoutMs: 45000,
    // DBpedia content-negotiates strictly - the default Accept: application/json
    // gets a 406. ("...results+json" still passes fetchJson's JSON content check.)
    headers: { Accept: "application/sparql-results+json" },
  });
  const out = new Map<string, DbpediaResult>();
  for (const b of data.results?.bindings ?? []) {
    let entry = out.get(b.start.value);
    if (!entry) {
      entry = { label: b.label.value, thumb: b.thumb.value, subjects: [] };
      out.set(b.start.value, entry);
    }
    const subject = b.subject?.value;
    if (subject) {
      // ".../Category:Tourist_attractions_in_Agra" → "tourist attractions in agra"
      const tail = subject.split("/").pop() ?? "";
      entry.subjects.push(normalizeNameKey(decodeURIComponent(tail).replace(/^Category:/, "")));
    }
  }
  return out;
}

/** Canonicalize a DBpedia thumbnail to the Special:FilePath width=800 form. */
function normalizeCommonsThumb(raw: string): string | null {
  const m = /Special:FilePath\/([^?]+)/.exec(raw);
  if (!m) return null;
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1]}?width=800`;
  return url.length <= MAX_IMAGE_URL_LEN ? url : null;
}

/**
 * DBpedia mode: resolve a batch of places in ~1 SPARQL query. Checks the
 * 30d cache first; writes positive AND negative cache entries for every
 * fresh lookup. Returns hits keyed by place id.
 */
export async function dbpediaPhotosForBatch(places: PlaceRow[]): Promise<Map<number, PhotoHit>> {
  const hits = new Map<number, PhotoHit>();
  const uncached: PlaceRow[] = [];
  for (const p of places) {
    const cached = await cacheGet<CachedPhoto>(photoCacheKey(p.name, p.city));
    if (cached) {
      if (cached.image) {
        hits.set(Number(p.id), {
          image: cached.image,
          attribution: cached.attribution ?? "Wikimedia Commons",
          title: cached.title ?? "",
        });
      }
    } else {
      uncached.push(p);
    }
  }
  if (uncached.length === 0) return hits;

  const candToPlace = new Map<string, PlaceRow>();
  const plainCandidateOf = new Map<string, number>(); // plain "{name}" IRI → place id
  const candidates: string[] = [];
  for (const p of uncached) {
    const plain = dbpediaIri(p.name);
    const withCity = dbpediaIri(`${p.name}, ${p.city}`);
    for (const iri of [plain, withCity]) {
      if (iri && !candToPlace.has(iri)) {
        candToPlace.set(iri, p);
        candidates.push(iri);
      }
    }
    if (plain) plainCandidateOf.set(plain, Number(p.id));
  }
  const found = await fetchDbpediaThumbs(candidates);

  // Prefer the plain "{name}" candidate over "{name}, {city}" per place.
  const bestByPlace = new Map<number, { iri: string } & DbpediaResult>();
  for (const [iri, r] of found) {
    const p = candToPlace.get(iri);
    if (!p) continue;
    const id = Number(p.id);
    if (!bestByPlace.has(id) || plainCandidateOf.get(iri) === id) {
      bestByPlace.set(id, { iri, ...r });
    }
  }

  for (const p of uncached) {
    const id = Number(p.id);
    const r = bestByPlace.get(id);
    let hit: PhotoHit | null = null;
    if (r) {
      const nameKey = normalizeNameKey(p.name);
      // The candidate IRI was built from the place name itself and DBpedia
      // resolved it - following Wikipedia's OWN redirects when they exist
      // ("Qutub Minar" → "Qutb Minar", "Lalbagh Botanical Garden" →
      // "Lal Bagh"). A resolved resource IS the name match; the target's
      // label may differ from the queried title, so it is NOT re-validated.
      const fuzzyOk = nameKey.length >= 4;
      // City pin for ≤2-word names (same spirit as the Wikipedia-mode
      // titleMatchesPlace): a city token must appear in the article label or
      // its dct:subject categories ("tourist attractions in agra") - 
      // otherwise "Central Park (Varanasi)" would inherit New York's photo.
      // >2-word names are specific enough on their own.
      const contextKey = normalizeNameKey(`${r.label} ${r.subjects.join(" ")}`);
      const cityOk =
        nameKey.split(" ").length > 2 || cityTokenIn(contextKey, normalizeNameKey(p.city));
      // Reject non-place articles: biographies ("1910 births") and creative
      // works (films/albums/songs/novels/TV) - their infobox image is a
      // portrait or poster, never the place ("Some Like It Hot" the Mumbai
      // eatery must not get the 1959 movie poster).
      const nonPlace = r.subjects.some((s) => NON_PLACE_SUBJECT.test(s));
      if (fuzzyOk && cityOk && !nonPlace) {
        const url = normalizeCommonsThumb(r.thumb);
        if (url) hit = { image: url, attribution: "Wikimedia Commons", title: r.label };
      }
    }
    await cacheSet(
      photoCacheKey(p.name, p.city),
      hit ? { image: hit.image, attribution: hit.attribution, title: hit.title } : { image: null },
      TTL_30D,
    );
    if (hit) hits.set(id, hit);
  }
  return hits;
}

// ─── checkpoint ──────────────────────────────────────────────────────────────

interface Checkpoint {
  lastId: number;
  hits: number;
  misses: number;
  errors: number;
  updatedAt: string;
}

async function loadCheckpoint(): Promise<Checkpoint> {
  if (RESTART) return { lastId: 0, hits: 0, misses: 0, errors: 0, updatedAt: "" };
  const cp = await cacheGet<Checkpoint>(CHECKPOINT_KEY);
  return cp ?? { lastId: 0, hits: 0, misses: 0, errors: 0, updatedAt: "" };
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await cacheSet(CHECKPOINT_KEY, { ...cp, updatedAt: new Date().toISOString() }, TTL_30D);
}

// ─── legacy adoption: seed-images.ts left wikimedia images w/o photoSource ───

async function adoptLegacyWikimediaImages(db: ReturnType<typeof getDb>): Promise<number> {
  const res = await db.execute(sql`
    UPDATE explore_places
    SET photoSource = 'wikipedia',
        photoAttribution = COALESCE(photoAttribution, 'Wikipedia')
    WHERE photoSource IS NULL
      AND image IS NOT NULL
      AND (image LIKE '%wikimedia%' OR image LIKE '%wikipedia%')
  `);
  const header = Array.isArray(res) ? res[0] : res;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}

// ─── driver ──────────────────────────────────────────────────────────────────

async function main() {
  const db = getDb();

  const adopted = await adoptLegacyWikimediaImages(db);
  console.log(`[seed-photos] adopted ${adopted} legacy wikimedia images (photoSource was NULL)`);

  const useWikipedia = await wikipediaReachable();
  console.log(
    `[seed-photos] backend: ${useWikipedia ? "Wikipedia REST v1" : "DBpedia SPARQL (Wikipedia unreachable from this network)"}`,
  );

  // "Needs a photo": image NULL, or a shared local stock placeholder
  // ("/place-temple.jpg" etc. from the original curated seed - those ARE the
  // wrong-photo problem; same definition db/seed-images.ts used).
  const needsImage = or(
    isNull(schema.explorePlaces.image),
    like(schema.explorePlaces.image, "/%"),
  );

  // Target set: must-see + top-1500-by-rating + all Bengaluru + named cities - 
  // or, with --country, every image-less row of that country.
  let all: { id: number | bigint; name: string; city: string }[];
  if (COUNTRY) {
    all = await db
      .select({
        id: schema.explorePlaces.id,
        name: schema.explorePlaces.name,
        city: schema.explorePlaces.city,
      })
      .from(schema.explorePlaces)
      .where(and(needsImage, eq(schema.explorePlaces.country, COUNTRY)))
      .orderBy(
        // Editorial priority: must-see → famous eatery → getaway
        // (hike/waterfall/viewpoint) → everything else by rating.
        sql`CASE WHEN ${schema.explorePlaces.verdict} = 'must-see' THEN 0
                 WHEN ${schema.explorePlaces.famousEatery} = 1 THEN 1
                 WHEN JSON_OVERLAPS(${schema.explorePlaces.tags}, '["hike","waterfall","viewpoint"]') THEN 2
                 ELSE 3 END`,
        desc(schema.explorePlaces.rating),
        asc(schema.explorePlaces.id),
      );
  } else {
    const top1500 = await db
      .select({ id: schema.explorePlaces.id })
      .from(schema.explorePlaces)
      .where(needsImage)
      .orderBy(desc(schema.explorePlaces.rating), asc(schema.explorePlaces.id))
      .limit(1500);
    const topIds = top1500.map((r) => Number(r.id));

    const cityMatches = TARGET_CITY_SUBSTRINGS.map(
      (c) => sql`LOWER(${schema.explorePlaces.city}) LIKE ${"%" + c + "%"}`,
    );
    const targetWhere = and(
      needsImage,
      or(
        eq(schema.explorePlaces.verdict, "must-see"),
        ...cityMatches,
        topIds.length > 0 ? inArray(schema.explorePlaces.id, topIds) : undefined,
      ),
    );
    all = await db
      .select({
        id: schema.explorePlaces.id,
        name: schema.explorePlaces.name,
        city: schema.explorePlaces.city,
      })
      .from(schema.explorePlaces)
      .where(targetWhere)
      .orderBy(asc(schema.explorePlaces.id));
  }

  const cp = await loadCheckpoint();
  // Country mode: priority order isn't id-monotonic, so no id-checkpoint - 
  // re-walking is cheap (hits leave the target set, misses are 30d-cached).
  const rows = !COUNTRY && cp.lastId > 0 ? all.filter((r) => Number(r.id) > cp.lastId) : all;
  console.log(
    `[seed-photos] targets: ${all.length} image-less rows${COUNTRY ? ` (country=${COUNTRY}, priority order)` : ` (${rows.length} after checkpoint ${cp.lastId || "none"}${RESTART ? ", --restart" : ""})`}`,
  );

  let hits = cp.hits;
  let misses = cp.misses;
  let errors = cp.errors;
  let skippedGeneric = 0;
  let consecutiveErrors = 0;
  let processed = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const started = Date.now();
    try {
      if (useWikipedia) {
        // ── Wikipedia REST mode: per place, throttled ──
        for (const place of batch) {
          const id = Number(place.id);
          if (isGenericName(place.name)) {
            skippedGeneric++;
            cp.lastId = id;
            continue;
          }
          const oneStart = Date.now();
          try {
            const { hit, fromCache } = await wikiPhotoForPlace(place.name, place.city);
            consecutiveErrors = 0;
            if (hit) {
              await db
                .update(schema.explorePlaces)
                .set({ image: hit.image, photoSource: "wikipedia", photoAttribution: hit.attribution })
                .where(eq(schema.explorePlaces.id, Number(place.id)));
              hits++;
            } else {
              misses++;
            }
            if (!fromCache) {
              const elapsed = Date.now() - oneStart;
              if (elapsed < THROTTLE_MS) await sleep(THROTTLE_MS - elapsed);
            }
          } catch (e) {
            errors++;
            consecutiveErrors++;
            console.warn(
              `[seed-photos] lookup error for "${place.name}" (${place.city}): ${e instanceof Error ? e.message : e}`,
            );
            await sleep(1500); // brief backoff; row stays image-less for a later --restart pass
          }
          cp.lastId = id;
          processed++;
          if (processed % 50 === 0) {
            console.log(
              `[seed-photos] ${processed}/${rows.length}, hits ${hits}, misses ${misses}, errors ${errors}, generic-skipped ${skippedGeneric}`,
            );
          }
        }
      } else {
        // ── DBpedia mode: whole batch in ~1 SPARQL query ──
        const eligible: PlaceRow[] = [];
        for (const place of batch) {
          if (isGenericName(place.name)) {
            skippedGeneric++;
            cp.lastId = Number(place.id);
          } else {
            eligible.push(place);
          }
        }
        const found = await dbpediaPhotosForBatch(eligible);
        consecutiveErrors = 0;
        for (const place of eligible) {
          const id = Number(place.id);
          const hit = found.get(id);
          if (hit) {
            await db
              .update(schema.explorePlaces)
              .set({ image: hit.image, photoSource: "wikipedia", photoAttribution: hit.attribution })
              .where(eq(schema.explorePlaces.id, id));
            hits++;
          } else {
            misses++;
          }
          cp.lastId = id;
          processed++;
        }
        if (processed % 200 < BATCH) {
          console.log(
            `[seed-photos] ${processed}/${rows.length}, hits ${hits}, misses ${misses}, errors ${errors}, generic-skipped ${skippedGeneric}`,
          );
        }
        const elapsed = Date.now() - started;
        if (elapsed < THROTTLE_MS) await sleep(THROTTLE_MS - elapsed);
      }
    } catch (e) {
      // Batch-level failure (DBpedia query, DB write): count once, back off,
      // keep the checkpoint at the batch start so a re-run retries it.
      errors += 1;
      consecutiveErrors++;
      console.warn(`[seed-photos] batch error at id>${cp.lastId}: ${e instanceof Error ? e.message : e}`);
      await sleep(2000);
    }
    // Checkpoint after every batch (survives sandbox wipes).
    cp.hits = hits;
    cp.misses = misses;
    cp.errors = errors;
    await saveCheckpoint(cp);
    if (consecutiveErrors >= 8) {
      console.error("[seed-photos] too many consecutive errors, stopping (checkpoint saved; re-run to resume)");
      break;
    }
  }
  cp.hits = hits;
  cp.misses = misses;
  cp.errors = errors;
  await saveCheckpoint(cp);

  console.log(
    `\n[seed-photos] done: ${processed} processed, ${hits} hits, ${misses} misses (no Wikipedia photo), ${errors} errors, ${skippedGeneric} generic names skipped`,
  );
  const stats = await db.execute(
    sql`SELECT photoSource, COUNT(*) AS n FROM explore_places GROUP BY photoSource`,
  );
  console.log("[seed-photos] coverage by photoSource:", (stats as unknown as unknown[])[0] ?? stats);
  process.exit(0);
}

// Run only when executed directly (importable for tests/debug scripts).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[seed-photos] FAILED:", e);
    process.exit(1);
  });
}
