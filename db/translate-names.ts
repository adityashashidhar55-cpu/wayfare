/**
 * translate-names.ts (r19-portal) — backfill English/Latin display names for
 * explore_places rows whose `name` is in a non-Latin script (owner pain:
 * "places in Saudi are in Arabic, translation needed").
 *
 * Two passes:
 *
 *   (a) OFFLINE — rows whose name is a bilingual mashup ("Mémorial Yves
 *       Saint Laurent نصب تذكاري…") split locally via splitBilingual():
 *       name=latin segment, nameLocal=full original. No network. Runs fully.
 *
 *   (b) NETWORK — rows with a non-Latin name, an osmId and nameLocal IS NULL:
 *       batched 40 osm ids per Overpass call (`node(id:…);way(id:…);…;out
 *       tags;`), taking name:en → int_name → name:en-Latn → name:latin from
 *       the fetched tags. osmIds with no English form get a 30d negative
 *       cache entry (`latname:<osmId>`) so re-runs skip them. Throttled
 *       1200 ms between Overpass calls; mirrors rotate on 429/504 with
 *       backoff. Progress checkpoints to api_cache `seed:translate:progress`
 *       (last processed row id) so a re-run resumes where it stopped.
 *
 * Flags:
 *   --max=N    cap rows processed in the NETWORK pass (offline always runs fully)
 *   --reset    ignore the checkpoint and start the network pass from id 0
 *
 * Run:  npx tsx db/translate-names.ts --max=400
 */
import { asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../api/queries/connection";
import { cacheGet, cacheSet } from "../api/lib/cache";
import { ExternalApiError, fetchJson } from "../api/lib/http";
import {
  EN_NAME_TAG_KEYS,
  hasNonLatinScript,
  splitBilingual,
} from "../api/lib/latin-name";
import { OVERPASS_MIRRORS } from "../api/queries/coverage";

const USER_AGENT = "Wayfare/1.0 (travel app; place-name translation backfill)";
const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 1_200;
const BATCH_SIZE = 40;
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000];
const CHECKPOINT_KEY = "seed:translate:progress";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function argValue(flag: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

/** Any char outside printable ASCII — cheap SQL prefilter; JS re-validates. */
const NON_ASCII_SQL = sql`name REGEXP '[^ -~]'`;

interface OsmTagElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
}

let mirrorIdx = 0;

/** POST one tag-fetch query, rotating mirrors on 429/504/timeout with backoff. */
async function fetchTags(query: string): Promise<OsmTagElement[]> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    const endpoint = OVERPASS_MIRRORS[mirrorIdx % OVERPASS_MIRRORS.length]!;
    try {
      const data = await fetchJson<{ elements?: OsmTagElement[] }>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 30_000,
        userAgent: USER_AGENT,
        service: "overpass",
      });
      return Array.isArray(data.elements) ? data.elements : [];
    } catch (e) {
      lastErr = e;
      const status = e instanceof ExternalApiError ? e.status : null;
      console.log(
        `  overpass mirror ${endpoint} failed (${status ?? "network/timeout"}); rotating`,
      );
      mirrorIdx++; // rotate on ANY failure; backoff below paces the retry
      if (attempt < BACKOFF_MS.length - 1) await sleep(BACKOFF_MS[attempt]!);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("overpass tag fetch failed");
}

/** name:en → int_name → name:en-Latn → name:latin, first non-empty. */
function englishFromTags(tags: Record<string, string>): string | null {
  for (const k of EN_NAME_TAG_KEYS) {
    const v = (tags[k] ?? "").trim();
    if (v) return v;
  }
  return null;
}

async function offlinePass(db: ReturnType<typeof getDb>): Promise<number> {
  const rows = await db
    .select({ id: schema.explorePlaces.id, name: schema.explorePlaces.name })
    .from(schema.explorePlaces)
    .where(sql`${isNull(schema.explorePlaces.nameLocal)} AND ${NON_ASCII_SQL}`);
  let updated = 0;
  for (const row of rows) {
    const bi = splitBilingual(row.name);
    if (!bi) continue;
    await db
      .update(schema.explorePlaces)
      .set({ name: bi.latin.slice(0, 255), nameLocal: row.name.slice(0, 255) })
      .where(eq(schema.explorePlaces.id, row.id));
    updated++;
    if (updated % 25 === 0) console.log(`offline: ${updated} bilingual names split…`);
  }
  console.log(`offline pass: scanned ${rows.length} non-ASCII rows, split ${updated}`);
  return updated;
}

interface NetworkRow {
  id: number;
  name: string;
  osmId: string;
}

async function networkPass(db: ReturnType<typeof getDb>, max: number): Promise<void> {
  const reset = process.argv.includes("--reset");
  const checkpoint = reset ? null : await cacheGet<{ lastId?: number }>(CHECKPOINT_KEY);
  const lastId = checkpoint?.lastId ?? 0;
  if (lastId > 0) console.log(`network pass: resuming after row id ${lastId}`);

  const candidates = await db
    .select({
      id: schema.explorePlaces.id,
      name: schema.explorePlaces.name,
      osmId: schema.explorePlaces.osmId,
    })
    .from(schema.explorePlaces)
    .where(
      sql`${isNull(schema.explorePlaces.nameLocal)}
        AND ${isNotNull(schema.explorePlaces.osmId)}
        AND ${gt(schema.explorePlaces.id, lastId)}
        AND ${NON_ASCII_SQL}`,
    )
    .orderBy(asc(schema.explorePlaces.id));

  // JS re-validation: genuinely non-Latin, not already a splittable mashup,
  // well-formed osmId. The 30d negative-cache check runs LAZILY below (one
  // remote cache read per row) so a bounded --max run never scans all ~27k
  // candidates before its first Overpass call.
  const eligible: NetworkRow[] = [];
  for (const r of candidates) {
    if (!r.osmId || !/^(node|way|relation)\/\d+$/.test(r.osmId)) continue;
    if (!hasNonLatinScript(r.name) || splitBilingual(r.name)) continue;
    eligible.push({ id: Number(r.id), name: r.name, osmId: r.osmId });
  }

  // Collect up to `max` processable rows, skipping negatively cached osmIds.
  const rows: NetworkRow[] = [];
  let negCached = 0;
  for (const r of eligible) {
    if (rows.length >= max) break;
    const neg = await cacheGet<{ none: true }>(`latname:${r.osmId}`);
    if (neg) {
      negCached++;
      continue;
    }
    rows.push(r);
  }
  console.log(
    `network pass: ${candidates.length} candidates (${eligible.length} eligible), ${negCached} skipped (30d no-English cache), translating ${rows.length} (max ${max === Number.POSITIVE_INFINITY ? "∞" : max})`,
  );

  let translated = 0;
  let noEnglish = 0;
  let processed = 0;
  let cursor = lastId;

  for (let i = 0; i < rows.length && processed < max; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const byType = { node: [] as string[], way: [] as string[], relation: [] as string[] };
    for (const r of batch) {
      const [type, num] = r.osmId.split("/") as [keyof typeof byType, string];
      byType[type].push(num);
    }
    const clauses = (Object.keys(byType) as (keyof typeof byType)[])
      .filter((t) => byType[t].length > 0)
      .map((t) => `${t}(id:${byType[t].join(",")});`)
      .join("");
    const query = `[out:json][timeout:25];${clauses}out tags;`;

    if (i > 0) await sleep(THROTTLE_MS);
    let elements: OsmTagElement[];
    try {
      elements = await fetchTags(query);
    } catch (e) {
      console.error(
        `network pass: overpass unreachable after retries at row id ${cursor} — stopping (checkpoint saved)`,
        e instanceof Error ? e.message : e,
      );
      break;
    }

    const tagsByOsmId = new Map<string, Record<string, string>>();
    for (const el of elements) {
      tagsByOsmId.set(`${el.type}/${el.id}`, el.tags ?? {});
    }

    for (const r of batch) {
      processed++;
      cursor = Math.max(cursor, r.id);
      const tags = tagsByOsmId.get(r.osmId);
      const en = tags ? englishFromTags(tags) : null;
      if (!en || en === r.name) {
        // No English form (or element gone / English identical) — 30d negative cache.
        await cacheSet(`latname:${r.osmId}`, { none: true }, TTL_30D);
        noEnglish++;
        continue;
      }
      await db
        .update(schema.explorePlaces)
        .set({ name: en.slice(0, 255), nameLocal: r.name.slice(0, 255) })
        .where(eq(schema.explorePlaces.id, r.id));
      translated++;
    }
    await cacheSet(CHECKPOINT_KEY, { lastId: cursor }, TTL_30D);
    console.log(
      `network: ${processed}/${Math.min(rows.length, max)} processed — ${translated} translated, ${noEnglish} no-english (last id ${cursor})`,
    );
  }

  console.log(
    `network pass done: ${processed} processed, ${translated} translated, ${noEnglish} no-english (negative-cached)`,
  );
}

async function main() {
  const max = Number(argValue("--max") ?? "0") || Number.POSITIVE_INFINITY;
  const db = getDb();
  await offlinePass(db);
  if (max > 0) await networkPass(db, max);
  else console.log("network pass: skipped (pass --max=N to enable)");
  process.exit(0);
}

main().catch((e) => {
  console.error("translate-names: fatal", e);
  process.exit(1);
});
