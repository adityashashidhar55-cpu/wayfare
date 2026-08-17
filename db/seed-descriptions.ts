/**
 * seed-descriptions.ts (r18-stories) - prioritized description backfill for
 * explore_places rows with NULL/empty descriptions.
 *
 * Priority tiers (highest editorial value first):
 *   0. verdict = 'must-see'
 *   1. famousEatery = 1
 *   2. historic-tagged (tags LIKE temple|church|mosque|fort|palace|monument|
 *      castle|ruins|heritage|historic|shrine|cathedral)
 *   3. everything else
 * (Tiers overlap on paper, but a row processed in an earlier tier leaves the
 * NULL/empty target set, so it is never touched twice.)
 *
 * Per place:
 *   fetchDbpediaAbstract(name, city) → cleanAbstract() →
 *     hit:  UPDATE description + descriptionSource='dbpedia'
 *     miss: composeDescription(structured fields) → descriptionSource='composed'
 *   The composed fallback is HONEST - category/city/tags/verdict facts only,
 *   zero invented history (api/lib/place-story.ts).
 *
 * Politeness & resume:
 *   - batches of 50, 300ms throttle between DBpedia calls,
 *   - checkpoint every 50 rows in api_cache ('seed:descriptions:progress',
 *     {tier, lastId, done, dbpedia, composed, skipped, failed}) - re-run
 *     resumes where the last run was killed,
 *   - DBpedia hits/misses are themselves cached 30d (wikidesc:*).
 *
 * Flags:  --max=N        bound this run to N processed rows (default unlimited)
 *         --only-india   restrict to country='India'
 *         --no-dbpedia   compose-only (skip SPARQL - sandbox mirror has no abstracts)
 *         --restart      ignore the checkpoint and re-walk from tier 0
 *
 * Run:  npx tsx db/seed-descriptions.ts --max=40 --only-india
 */
import { and, asc, eq, gt, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { cacheGet, cacheSet } from "../api/lib/cache";
import {
  cleanAbstract,
  composeDescription,
  fetchDbpediaAbstract,
} from "../api/lib/place-story";

const CHECKPOINT_KEY = "seed:descriptions:progress";
const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const BATCH = 50;
const THROTTLE_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HISTORIC_TAGS = [
  "temple", "church", "mosque", "fort", "palace", "monument",
  "castle", "ruins", "heritage", "historic", "shrine", "cathedral",
];

interface Checkpoint {
  tier: number;
  lastId: number;
  done: number;
  dbpedia: number;
  composed: number;
  skipped: number;
  failed: number;
  updatedAt: string;
}

function parseArgs() {
  let max = Infinity;
  let onlyIndia = false;
  let restart = false;
  let noDbpedia = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--max=")) max = Math.max(0, Number(arg.slice("--max=".length)) || 0);
    else if (arg === "--only-india") onlyIndia = true;
    else if (arg === "--restart") restart = true;
    else if (arg === "--no-dbpedia") noDbpedia = true;
  }
  return { max, onlyIndia, restart, noDbpedia };
}

/** Rows still needing a description. */
const emptyDescription = () =>
  sql`(${schema.explorePlaces.description} IS NULL OR TRIM(${schema.explorePlaces.description}) = '')`;

/** Extra WHERE for each priority tier (overlaps are harmless - see header). */
function tierCondition(tier: number): SQL | undefined {
  switch (tier) {
    case 0:
      return eq(schema.explorePlaces.verdict, "must-see");
    case 1:
      return eq(schema.explorePlaces.famousEatery, true);
    case 2:
      return or(...HISTORIC_TAGS.map((t) => like(schema.explorePlaces.tags, `%${t}%`)));
    default:
      return undefined;
  }
}

async function main() {
  const { max, onlyIndia, restart, noDbpedia } = parseArgs();
  if (noDbpedia) {
    console.log("[seed-desc] --no-dbpedia: compose-only mode (sandbox DBpedia mirror has no abstracts)");
  }
  let cp = (!restart && (await cacheGet<Checkpoint>(CHECKPOINT_KEY))) || null;
  if (cp) {
    console.log(
      `[seed-desc] resuming at tier ${cp.tier} after id ${cp.lastId} ` +
        `(done ${cp.done}, dbpedia ${cp.dbpedia}, composed ${cp.composed}, failed ${cp.failed})`,
    );
  } else {
    cp = { tier: 0, lastId: 0, done: 0, dbpedia: 0, composed: 0, skipped: 0, failed: 0, updatedAt: "" };
  }

  const db = getDb();
  const save = () =>
    cacheSet(CHECKPOINT_KEY, { ...cp!, updatedAt: new Date().toISOString() }, TTL_30D);

  const baseConds: SQL[] = [emptyDescription()];
  if (onlyIndia) baseConds.push(eq(schema.explorePlaces.country, "India"));

  let processed = 0;
  const t0 = Date.now();

  outer: for (let tier = cp.tier; tier <= 3; tier++) {
    let lastId = tier === cp.tier ? cp.lastId : 0;
    const tierCond = tierCondition(tier);
    const tierNames = ["must-see", "famous-eatery", "historic-tagged", "everything-else"];
    console.log(`[seed-desc] ── tier ${tier} (${tierNames[tier]}) from id ${lastId}`);

    for (;;) {
      const conds = [...baseConds, gt(schema.explorePlaces.id, lastId)];
      if (tierCond) conds.push(tierCond);
      const rows = await db
        .select({
          id: schema.explorePlaces.id,
          name: schema.explorePlaces.name,
          city: schema.explorePlaces.city,
          country: schema.explorePlaces.country,
          category: schema.explorePlaces.category,
          tags: schema.explorePlaces.tags,
          verdict: schema.explorePlaces.verdict,
          famousEatery: schema.explorePlaces.famousEatery,
          feeCents: schema.explorePlaces.feeCents,
          feeCurrency: schema.explorePlaces.feeCurrency,
        })
        .from(schema.explorePlaces)
        .where(and(...conds))
        .orderBy(asc(schema.explorePlaces.id))
        .limit(BATCH);
      if (!rows.length) break;

      for (const row of rows) {
        lastId = row.id;
        try {
          if (!noDbpedia) await sleep(THROTTLE_MS); // polite pacing between DBpedia calls
          const hit = noDbpedia ? null : await fetchDbpediaAbstract(row.name, row.city);
          const cleaned = hit ? cleanAbstract(hit.abstract) : null;
          if (cleaned) {
            await db
              .update(schema.explorePlaces)
              .set({ description: cleaned, descriptionSource: "dbpedia" })
              .where(eq(schema.explorePlaces.id, row.id));
            cp.dbpedia++;
            console.log(`[seed-desc] #${row.id} ${row.name} (${row.city}), dbpedia "${hit!.title}"`);
          } else {
            const composed = composeDescription(row);
            if (!composed.trim()) {
              cp.skipped++;
              console.log(`[seed-desc] #${row.id} ${row.name} (${row.city}). SKIP (nothing to compose)`);
            } else {
              await db
                .update(schema.explorePlaces)
                .set({ description: composed, descriptionSource: "composed" })
                .where(eq(schema.explorePlaces.id, row.id));
              cp.composed++;
              console.log(`[seed-desc] #${row.id} ${row.name} (${row.city}), composed`);
            }
          }
          cp.done++;
        } catch (e) {
          cp.failed++;
          console.error(
            `[seed-desc] #${row.id} ${row.name} (${row.city}). FAIL ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        processed++;
        if (processed % BATCH === 0) {
          cp.tier = tier;
          cp.lastId = lastId;
          await save();
          console.log(
            `[seed-desc] checkpoint: ${processed} this run, dbpedia ${cp.dbpedia}, composed ${cp.composed}, failed ${cp.failed}`,
          );
        }
        if (processed >= max) {
          cp.tier = tier;
          cp.lastId = lastId;
          await save();
          console.log(`[seed-desc] --max=${max} reached`);
          break outer;
        }
      }
    }
    // tier exhausted - checkpoint the transition
    cp.tier = Math.min(tier + 1, 3);
    cp.lastId = 0;
    await save();
  }

  await save();
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(
    `[seed-desc] COMPLETE, ${processed} processed this run in ${secs}s ` +
      `(done ${cp.done}, dbpedia ${cp.dbpedia}, composed ${cp.composed}, skipped ${cp.skipped}, failed ${cp.failed})`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-desc] fatal", e);
  process.exit(1);
});
