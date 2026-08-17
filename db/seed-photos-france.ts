/**
 * seed-photos-france.ts (r16-france) - France-scoped wrapper around the
 * proven db/seed-photos.ts photo engines. The corpus' France rows (all Paris
 * today) overwhelmingly hold generic local stock placeholders; this backfills
 * REAL photos from Wikipedia (primary) / DBpedia (fallback, used from this
 * sandbox where wikimedia.org is TCP-blocked).
 *
 * Target set: explore_places WHERE country='France' AND (image IS NULL OR a
 * shared local "/place-*.jpg" stock placeholder) - i.e. "skip rows with a
 * real (http) image". Ordered by editorial priority so an interrupted run
 * lands the most valuable photos first:
 *     must-see → famousEatery (★) → top-rated (rating DESC, id ASC)
 * ("getaways" in the mission maps to the same rating-ordered long tail here - 
 * France has no separate getaway flag on explore_places.)
 *
 * Engine: reuses seed-photos.ts's exported wikiPhotoForPlace /
 * dbpediaPhotosForBatch / wikipediaReachable - same fuzzy title validation,
 * same 30d positive+negative api_cache, same DBpedia batching (~20/query).
 *
 * Resumable: processed ids checkpoint to api_cache
 * ('seed:photos:france:checkpoint') after every batch (sandbox wipes local
 * files, not the DB). Re-run to resume; --restart re-walks every image-less
 * row (cached, so still fast).
 *
 * Run:    npx tsx db/seed-photos-france.ts [--restart]
 * Bg:     nohup npx tsx db/seed-photos-france.ts > /tmp/seed-photos-fr.log 2>&1 &
 */
import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet } from "../api/lib/cache";
import { isGenericName } from "../api/lib/place-quality";
import {
  dbpediaPhotosForBatch,
  wikiPhotoForPlace,
  wikipediaReachable,
} from "./seed-photos";

const TTL_30D = 30 * 24 * 60 * 60 * 1000;
// DBpedia (the only reachable photo backend from this sandbox - Wikipedia is
// TCP-blocked) rate-limits HARD (HTTP 502 after a burst). So: small batches,
// generous inter-batch gap, and retry-on-502 with backoff. --max caps the
// prioritized target set so a run is tractable under the rate limit.
const BATCH = 10;
const THROTTLE_MS = 300; // Wikipedia mode only
const DBPEDIA_GAP_MS = 10_000; // between DBpedia batch queries
const RETRY_GAP_MS = 30_000; // backoff after a DBpedia 502/5xx
const MAX_RETRIES = 3;
const CHECKPOINT_KEY = "seed:photos:france:checkpoint";
const RESTART = process.argv.includes("--restart");
const COUNTRY = "France";
const MAX_ROWS = Number(process.argv[process.argv.indexOf("--max") + 1] ?? 0) || 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Checkpoint {
  doneIds: number[];
  hits: number;
  misses: number;
  errors: number;
  updatedAt: string;
}

async function loadCheckpoint(): Promise<Checkpoint> {
  if (RESTART) return { doneIds: [], hits: 0, misses: 0, errors: 0, updatedAt: "" };
  const cp = await cacheGet<Checkpoint>(CHECKPOINT_KEY);
  return cp ?? { doneIds: [], hits: 0, misses: 0, errors: 0, updatedAt: "" };
}
async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await cacheSet(CHECKPOINT_KEY, { ...cp, updatedAt: new Date().toISOString() }, TTL_30D);
}

/** France-scoped legacy adoption (seed-images.ts left wikimedia imgs w/o photoSource). */
async function adoptLegacy(db: ReturnType<typeof getDb>): Promise<number> {
  const res = await db.execute(sql`
    UPDATE explore_places
    SET photoSource = 'wikipedia',
        photoAttribution = COALESCE(photoAttribution, 'Wikipedia')
    WHERE country = ${COUNTRY}
      AND photoSource IS NULL
      AND image IS NOT NULL
      AND (image LIKE '%wikimedia%' OR image LIKE '%wikipedia%')
  `);
  const header = Array.isArray(res) ? res[0] : res;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}

async function main() {
  const db = getDb();

  const adopted = await adoptLegacy(db);
  if (adopted > 0) console.log(`[fr-photos] adopted ${adopted} legacy wikimedia images`);

  const useWikipedia = await wikipediaReachable();
  console.log(
    `[fr-photos] backend: ${useWikipedia ? "Wikipedia REST v1" : "DBpedia SPARQL (Wikipedia unreachable from this network)"}`,
  );

  // "Needs a photo": image NULL, or a shared local stock placeholder ("/place-…").
  const needsImage = or(
    isNull(schema.explorePlaces.image),
    like(schema.explorePlaces.image, "/%"),
  );

  // Priority: must-see → famousEatery → top-rated. (1/0 flags sort DESC first.)
  // Capped at MAX_ROWS so the DBpedia-rate-limited run stays tractable.
  const all = await db
    .select({
      id: schema.explorePlaces.id,
      name: schema.explorePlaces.name,
      city: schema.explorePlaces.city,
    })
    .from(schema.explorePlaces)
    .where(and(needsImage, eq(schema.explorePlaces.country, COUNTRY)))
    .orderBy(
      desc(sql`(${schema.explorePlaces.verdict} = 'must-see')`),
      desc(schema.explorePlaces.famousEatery),
      desc(schema.explorePlaces.rating),
      asc(schema.explorePlaces.id),
    )
    .limit(MAX_ROWS);

  const cp = await loadCheckpoint();
  const done = new Set(cp.doneIds);
  const rows = all.filter((r) => !done.has(Number(r.id)));
  console.log(
    `[fr-photos] targets: ${all.length} image-less France rows (${rows.length} after checkpoint ${done.size}${RESTART ? ", --restart" : ""})`,
  );

  let hits = cp.hits;
  let misses = cp.misses;
  let errors = cp.errors;
  let skippedGeneric = 0;
  let consecutiveErrors = 0;
  let processed = 0;
  const hitsByCity = new Map<string, number>();
  const bumpCity = (city: string) => hitsByCity.set(city, (hitsByCity.get(city) ?? 0) + 1);

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const started = Date.now();
    try {
      if (useWikipedia) {
        for (const place of batch) {
          const id = Number(place.id);
          if (isGenericName(place.name)) {
            skippedGeneric++;
            done.add(id);
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
                .where(eq(schema.explorePlaces.id, place.id));
              hits++;
              bumpCity(place.city);
            } else {
              misses++;
            }
            if (!fromCache) {
              const el = Date.now() - oneStart;
              if (el < THROTTLE_MS) await sleep(THROTTLE_MS - el);
            }
          } catch (e) {
            errors++;
            consecutiveErrors++;
            console.warn(`[fr-photos] lookup error "${place.name}": ${e instanceof Error ? e.message : e}`);
            await sleep(1500);
          }
          done.add(id);
          processed++;
        }
      } else {
        // DBpedia mode: whole batch in ~1 SPARQL query, retried on rate-limit.
        const eligible = batch.filter((p) => {
          if (isGenericName(p.name)) {
            skippedGeneric++;
            done.add(Number(p.id));
            return false;
          }
          return true;
        });
        let found: Map<number, import("./seed-photos").PhotoHit> | null = null;
        for (let attempt = 0; attempt <= MAX_RETRIES && found === null; attempt++) {
          try {
            found = await dbpediaPhotosForBatch(eligible);
          } catch (e) {
            const status = (e as { status?: number })?.status;
            const retriable = status === 429 || status === 502 || status === 503 || status === 504 || status == null;
            if (attempt < MAX_RETRIES && retriable) {
              console.warn(`[fr-photos] DBpedia ${status ?? "timeout"}, retry ${attempt + 1}/${MAX_RETRIES} in ${RETRY_GAP_MS / 1000}s`);
              await sleep(RETRY_GAP_MS);
            } else {
              throw e; // exhausted retries / non-retriable → outer catch
            }
          }
        }
        consecutiveErrors = 0;
        for (const place of eligible) {
          const id = Number(place.id);
          const hit = found!.get(id);
          if (hit) {
            await db
              .update(schema.explorePlaces)
              .set({ image: hit.image, photoSource: "wikipedia", photoAttribution: hit.attribution })
              .where(eq(schema.explorePlaces.id, id));
            hits++;
            bumpCity(place.city);
          } else {
            misses++;
          }
          done.add(id);
          processed++;
        }
        const el = Date.now() - started;
        if (el < DBPEDIA_GAP_MS) await sleep(DBPEDIA_GAP_MS - el); // respect the rate limit
      }
    } catch (e) {
      errors += 1;
      consecutiveErrors++;
      console.warn(`[fr-photos] batch error: ${e instanceof Error ? e.message : e}`);
      await sleep(2000);
    }
    cp.doneIds = Array.from(done);
    cp.hits = hits;
    cp.misses = misses;
    cp.errors = errors;
    await saveCheckpoint(cp);
    if (processed % 100 < BATCH) {
      console.log(
        `[fr-photos] ${done.size}/${all.length}, hits ${hits}, misses ${misses}, errors ${errors}, generic-skipped ${skippedGeneric}`,
      );
    }
    if (consecutiveErrors >= 8) {
      console.error("[fr-photos] too many consecutive errors, stopping (checkpoint saved; re-run to resume)");
      break;
    }
  }

  console.log(
    `\n[fr-photos] done: ${processed} processed this run, ${hits} hits, ${misses} misses, ${errors} errors, ${skippedGeneric} generic skipped`,
  );
  console.log("[fr-photos] hits by city:", JSON.stringify(Object.fromEntries(hitsByCity)));
  const stats = await db.execute(
    sql`SELECT city, SUM(image LIKE 'http%') AS withPhoto, COUNT(*) AS total FROM explore_places WHERE country=${COUNTRY} GROUP BY city`,
  );
  console.log("[fr-photos] France photo coverage:", (stats as unknown as unknown[])[0] ?? stats);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[fr-photos] FAILED:", e);
    process.exit(1);
  });
}
