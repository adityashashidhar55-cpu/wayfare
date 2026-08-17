/**
 * Give every explore_place its OWN photo (user demand: "not a random one").
 *
 * For rows whose image is NULL/empty - or still a shared local placeholder
 * ("/place-temple.jpg" etc. from the original curated seed) - look the place
 * up on Wikipedia and store its article photo.
 *
 * Lookup backends (auto-detected):
 *   1. Wikipedia pageimages API (primary):
 *      titles tried in order: "{name}", then "{name}, {city}", redirects=1,
 *      pithumbsize=640 - first article with a pageimage wins.
 *   2. DBpedia SPARQL (fallback for networks where wikipedia.org is
 *      unreachable): batched VALUES query over the same two candidate
 *      titles, following dbo:wikiPageRedirects, taking dbo:thumbnail.
 *      The Commons file URL is rewritten to a direct upload.wikimedia.org
 *      500px thumbnail (Wikimedia's largest standard bucket ≤640px) and
 *      verified with a HEAD request before storing; unverifiable or exotic
 *      file types fall back to the canonical Special:FilePath URL.
 *
 * Priority tiers:
 *   a) source='curated' (the original 350, all on generic stock images)
 *   b) source='user'
 *   c) source='osm' in IMAGE_CITIES only, capped at ~4,000 lookups;
 *      remaining OSM rows are skipped (they fall back to the deterministic
 *      tag pool in src/lib/place-images.ts).
 *
 * Idempotent: rows already holding an external (http) image are never
 * touched; known misses are remembered in db/.seed-images-cache.json so
 * re-runs stay fast and polite. Pass --fresh to ignore the miss cache.
 *
 * Run with: npx tsx db/seed-images.ts
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import dns from "node:dns";
import https from "node:https";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { and, eq, inArray, isNull, like, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { explorePlaces } from "./schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MISS_CACHE_PATH = join(__dirname, ".seed-images-cache.json");
const FRESH = process.argv.includes("--fresh");

/** OSM cities worth per-place lookups (brief: ~4,000 lookups cap). */
const IMAGE_CITIES = [
  "Paris",
  "London",
  "Rome",
  "Barcelona",
  "Lisbon",
  "Amsterdam",
  "Prague",
  "Vienna",
  "Budapest",
  "Istanbul",
  "Kyoto",
  "Tokyo",
  "New York",
  "Bangkok",
  "Singapore",
];

const OSM_LOOKUP_CAP = 4000;
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const DBPEDIA_SPARQL = "https://dbpedia.org/sparql";
const USER_AGENT =
  "WayfareImageSeed/1.0 (https://wayfare.app; travel-app seed script; contact dev@wayfare.app)";
/** Wikimedia's largest standard thumbnail bucket ≤ the 640px target. */
const THUMB_WIDTH = 500;
const MAX_URL_LEN = 500; // explore_places.image is varchar(512)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── rate limiter: ~8 requests/second, serialized ─────────────────────────────
const MIN_INTERVAL_MS = 125;
let nextSlotAt = 0;
async function takeSlot() {
  const now = Date.now();
  if (now < nextSlotAt) await sleep(nextSlotAt - now);
  nextSlotAt = Math.max(Date.now(), nextSlotAt) + MIN_INTERVAL_MS;
}

// ── miss cache (politeness across re-runs) ───────────────────────────────────
function loadMissCache(): Set<string> {
  if (FRESH || !existsSync(MISS_CACHE_PATH)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(MISS_CACHE_PATH, "utf8"));
    return new Set(Array.isArray(raw.misses) ? raw.misses : []);
  } catch {
    return new Set();
  }
}
function saveMissCache(misses: Set<string>) {
  writeFileSync(MISS_CACHE_PATH, JSON.stringify({ misses: [...misses] }, null, 0));
}
const cacheKey = (id: number, name: string) => `${id}:${name}`;

// ── Wikipedia pageimages backend (primary) ───────────────────────────────────
interface WikiPage {
  title?: string;
  missing?: boolean;
  thumbnail?: { source: string };
}

let wikiLookups = 0;

async function fetchWikiThumb(title: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query",
    prop: "pageimages",
    titles: title,
    pithumbsize: "640",
    redirects: "1",
    format: "json",
    formatversion: "2",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await takeSlot();
    wikiLookups++;
    try {
      const res = await fetch(`${WIKI_API}?${params}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as { query?: { pages?: WikiPage[] } };
      const page = data.query?.pages?.[0];
      if (!page || page.missing || !page.thumbnail?.source) return null;
      return page.thumbnail.source;
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

/** One probe to decide whether the Wikipedia API is reachable at all. */
async function wikipediaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${WIKI_API}?action=query&meta=siteinfo&format=json`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── DBpedia backend (fallback; same candidate titles, batched) ───────────────
/** "Time Out Market" → http://dbpedia.org/resource/Time_Out_Market */
function dbpediaIri(title: string): string | null {
  const t = title.trim().replace(/\s+/g, "_");
  if (!t || /["<>{}|^`\\]/.test(t)) return null; // illegal inside SPARQL IRIREF
  const encoded = Array.from(t)
    .map((ch) => (/[A-Za-z0-9_\-.,'()!~&;=:@$*+]/.test(ch) ? ch : encodeURIComponent(ch)))
    .join("");
  return `http://dbpedia.org/resource/${encoded}`;
}

interface SparqlBinding {
  start: { value: string };
  thumb: { value: string };
}

/** Batched lookup: candidate IRIs → dbo:thumbnail (following redirects). */
async function fetchDbpediaThumbs(candidates: string[]): Promise<Map<string, string>> {
  const values = candidates.map((c) => `<${c}>`).join("\n    ");
  // property path: thumbnail on the article itself or on its redirect target
  // (one VALUES + path query is ~15x faster than a UNION on this endpoint)
  const query = `SELECT ?start ?thumb WHERE {
  VALUES ?start {
    ${values}
  }
  ?start <http://dbpedia.org/ontology/wikiPageRedirects>{0,1}/<http://dbpedia.org/ontology/thumbnail> ?thumb .
}`;
  const url = `${DBPEDIA_SPARQL}?query=${encodeURIComponent(query)}&format=${encodeURIComponent("application/sparql-results+json")}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    await takeSlot();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const data = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
      const out = new Map<string, string>();
      for (const b of data.results?.bindings ?? []) {
        if (!out.has(b.start.value)) out.set(b.start.value, b.thumb.value);
      }
      return out;
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  return new Map();
}

// ── Commons file URL helpers ─────────────────────────────────────────────────
const SKIP_FILE_RE = /\.(tiff?|pdf|djvu|ogv|ogg|oga|webm|mp3|wav|flac|mid)$/i;

/**
 * Rewrite a Special:FilePath thumbnail to a direct upload.wikimedia.org
 * thumb (md5-hashed path, standard 500px bucket). Returns null when the
 * file type can't render a bitmap thumb.
 */
function directCommonsThumb(filePathUrl: string): string | null {
  const m = /\/Special:FilePath\/([^?]+)/.exec(filePathUrl);
  if (!m) return null;
  const file = decodeURIComponent(m[1]!).replace(/ /g, "_");
  if (SKIP_FILE_RE.test(file)) return null;
  const isSvg = /\.svg$/i.test(file);
  if (!isSvg && !/\.(jpe?g|png|gif|webp)$/i.test(file)) return null;
  const md5 = createHash("md5").update(file).digest("hex");
  const enc = encodeURIComponent(file);
  const suffix = isSvg ? ".png" : "";
  const url = `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5.slice(0, 2)}/${enc}/${THUMB_WIDTH}px-${enc}${suffix}`;
  return url.length <= MAX_URL_LEN ? url : null;
}

/** Canonical fallback: Commons resolves width/type server-side. */
function specialFilePathUrl(filePathUrl: string): string | null {
  const m = /\/Special:FilePath\/([^?]+)/.exec(filePathUrl);
  if (!m) return null;
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1]}?width=${THUMB_WIDTH}`;
  return url.length <= MAX_URL_LEN ? url : null;
}

// ── thumbnail verification (HEAD against upload.wikimedia.org) ───────────────
// Some sandboxed networks DNS-poison wikimedia.org; the official anycast IPs
// keep verification working everywhere else too.
const UPLOAD_IPS = ["185.15.59.240", "208.80.154.240"];
let uploadIpIdx = 0;

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

const lookupForWikimedia = (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
  if (hostname === "upload.wikimedia.org") {
    uploadIpIdx += 1;
    const ip = UPLOAD_IPS[uploadIpIdx % UPLOAD_IPS.length]!;
    // Node 20's Happy-Eyeballs agent passes { all: true } and wants an array
    if (options?.all) callback(null, [{ address: ip, family: 4 }]);
    else callback(null, ip, 4);
    return;
  }
  dns.lookup(hostname, options as dns.LookupOneOptions, callback as (e: NodeJS.ErrnoException | null, a: string, f: number) => void);
};

async function headStatus(url: string): Promise<number> {
  await takeSlot();
  return new Promise((resolve) => {
    const req = https.request(
      url,
      { method: "HEAD", headers: { "User-Agent": USER_AGENT }, lookup: lookupForWikimedia, timeout: 15000 },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
    req.on("error", () => resolve(0));
    req.end();
  });
}

/** Accept only a verified-200 thumb; otherwise the canonical FilePath URL. */
async function bestImageUrl(filePathUrl: string): Promise<string | null> {
  const direct = directCommonsThumb(filePathUrl);
  if (direct && (await headStatus(direct)) === 200) return direct;
  return specialFilePathUrl(filePathUrl);
}

// ── tiers & driver ───────────────────────────────────────────────────────────
type PlaceRow = { id: number; name: string; city: string };

interface TierStat {
  label: string;
  considered: number;
  hits: number;
  misses: number;
  cachedMisses: number;
}

const needsImage = or(
  isNull(explorePlaces.image),
  eq(explorePlaces.image, ""),
  like(explorePlaces.image, "/%"), // shared local stock placeholders
);

const PLACE_COLS = { id: explorePlaces.id, name: explorePlaces.name, city: explorePlaces.city } as const;

async function main() {
  const db = getDb();
  const misses = loadMissCache();
  const stats: TierStat[] = [];
  let lookupCount = 0; // candidate titles tried (both backends)
  let osmSkipped = 0;
  let dirtyCache = 0;

  const useWikipedia = await wikipediaReachable();
  console.log(`[seed-images] backend: ${useWikipedia ? "Wikipedia pageimages API" : "DBpedia SPARQL (Wikipedia unreachable)"}`);

  async function saveHit(p: PlaceRow, url: string) {
    await db.update(explorePlaces).set({ image: url }).where(eq(explorePlaces.id, p.id));
  }
  function noteMiss(p: PlaceRow) {
    misses.add(cacheKey(p.id, p.name));
    if (++dirtyCache >= 200) {
      saveMissCache(misses);
      dirtyCache = 0;
    }
  }
  function pushStat(stat: TierStat) {
    stats.push(stat);
    console.log(
      `[seed-images] ${stat.label}: ${stat.hits} hits / ${stat.misses} misses / ${stat.cachedMisses} known-miss skipped (of ${stat.considered})`,
    );
  }

  /** Wikipedia mode: per-place, titles "{name}" then "{name}, {city}". */
  async function runTierWikipedia(label: string, rows: PlaceRow[], budget: number | null) {
    const stat: TierStat = { label, considered: rows.length, hits: 0, misses: 0, cachedMisses: 0 };
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i]!;
      if (budget != null && lookupCount >= budget) {
        osmSkipped += rows.length - i;
        break;
      }
      if (misses.has(cacheKey(p.id, p.name))) {
        stat.cachedMisses++;
        continue;
      }
      const titles = [p.name, `${p.name}, ${p.city}`];
      let url: string | null = null;
      for (const title of titles) {
        lookupCount++;
        url = await fetchWikiThumb(title);
        if (url) break;
      }
      if (url) {
        await saveHit(p, url);
        stat.hits++;
      } else {
        noteMiss(p);
        stat.misses++;
      }
      if ((stat.hits + stat.misses) % 100 === 0) {
        console.log(`[seed-images] ${label}: ${stat.hits + stat.misses}/${rows.length} (hits ${stat.hits})`);
      }
    }
    pushStat(stat);
  }

  /** DBpedia mode: same candidates, batched ~20 places per SPARQL query. */
  async function runTierDbpedia(label: string, rows: PlaceRow[], budget: number | null) {
    const stat: TierStat = { label, considered: rows.length, hits: 0, misses: 0, cachedMisses: 0 };
    const fresh = rows.filter((p) => {
      const known = misses.has(cacheKey(p.id, p.name));
      if (known) stat.cachedMisses++;
      return !known;
    });
    let cursor = 0;
    while (cursor < fresh.length) {
      if (budget != null && lookupCount >= budget) {
        osmSkipped += fresh.length - cursor;
        break;
      }
      // budget counts candidate titles (2 per place)
      const batchSize = budget != null ? Math.max(1, Math.min(20, Math.floor((budget - lookupCount) / 2))) : 20;
      const batch = fresh.slice(cursor, cursor + batchSize);
      cursor += batch.length;

      const candToPlace = new Map<string, PlaceRow>();
      const candidates: string[] = [];
      for (const p of batch) {
        for (const title of [p.name, `${p.name}, ${p.city}`]) {
          const iri = dbpediaIri(title);
          if (iri && !candToPlace.has(iri)) {
            candToPlace.set(iri, p);
            candidates.push(iri);
          }
        }
      }
      lookupCount += candidates.length;
      const thumbs = await fetchDbpediaThumbs(candidates);

      // prefer the plain "{name}" candidate over "{name}, {city}"
      const hitByPlace = new Map<number, string>();
      for (const [iri, thumb] of thumbs) {
        const p = candToPlace.get(iri);
        if (!p) continue;
        if (!hitByPlace.has(p.id) || iri === dbpediaIri(p.name)) hitByPlace.set(p.id, thumb);
      }
      for (const p of batch) {
        const thumb = hitByPlace.get(p.id);
        if (!thumb) {
          noteMiss(p);
          stat.misses++;
          continue;
        }
        const url = await bestImageUrl(thumb);
        if (url) {
          await saveHit(p, url);
          stat.hits++;
        } else {
          noteMiss(p);
          stat.misses++;
        }
      }
      if ((stat.hits + stat.misses) % 200 < 20) {
        console.log(`[seed-images] ${label}: ${stat.hits + stat.misses}/${fresh.length} fresh (hits ${stat.hits})`);
      }
    }
    pushStat(stat);
  }

  const runTier = useWikipedia ? runTierWikipedia : runTierDbpedia;

  // a) curated (350, generic local placeholders)
  const curated = await db
    .select(PLACE_COLS)
    .from(explorePlaces)
    .where(and(eq(explorePlaces.source, "curated"), needsImage))
    .orderBy(explorePlaces.id);
  await runTier("a/curated", curated, null);

  // b) user-submitted
  const user = await db
    .select(PLACE_COLS)
    .from(explorePlaces)
    .where(and(eq(explorePlaces.source, "user"), needsImage))
    .orderBy(explorePlaces.id);
  await runTier("b/user", user, null);

  // c) OSM in the big-name cities only, capped at ~OSM_LOOKUP_CAP lookups
  const osm = await db
    .select(PLACE_COLS)
    .from(explorePlaces)
    .where(
      and(
        eq(explorePlaces.source, "osm"),
        needsImage,
        inArray(
          sql`LOWER(${explorePlaces.city})`,
          IMAGE_CITIES.map((c) => c.toLowerCase()),
        ),
      ),
    )
    .orderBy(explorePlaces.city, explorePlaces.id);
  const capStart = lookupCount;
  await runTier("c/osm-cities", osm, capStart + OSM_LOOKUP_CAP);

  // skipped OSM everywhere else (other cities; over-cap remainder already counted)
  const [skipped] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(explorePlaces)
    .where(
      and(
        eq(explorePlaces.source, "osm"),
        needsImage,
        notInArray(
          sql`LOWER(${explorePlaces.city})`,
          IMAGE_CITIES.map((c) => c.toLowerCase()),
        ),
      ),
    );
  osmSkipped += Number(skipped?.c ?? 0);

  saveMissCache(misses);

  console.log("\n[seed-images] ── summary ──");
  for (const s of stats) {
    const tried = s.hits + s.misses;
    const rate = tried > 0 ? ((s.hits / tried) * 100).toFixed(1) : "-";
    console.log(
      `  ${s.label}: ${s.hits} hits, ${s.misses} misses (${rate}% of fresh lookups), ${s.cachedMisses} known-miss skipped, ${s.considered} considered`,
    );
  }
  console.log(`  candidate-title lookups: ${lookupCount}${useWikipedia ? ` (wiki API calls: ${wikiLookups})` : ""}`);
  console.log(`  OSM places skipped (other cities / over cap): ${osmSkipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-images] FAILED:", e);
  process.exit(1);
});
