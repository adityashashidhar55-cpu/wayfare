/**
 * Classification repair pass (r15-places) - re-derives category/tags/styles
 * for every explore_places row under the CURRENT classifier rules and writes
 * back only rows whose stored values differ. What it fixes:
 *
 *   - produce/wholesale/ambiguous markets misfiled as food  → shopping
 *     (vegetable markets were being suggested as restaurants)
 *   - thrill venues lumped into activity/family             → waterpark /
 *     themepark / games categories + fun tags + the adventure style
 *   - zoos/aquariums/playgrounds carrying the adventure style → family
 *     (adventure trips no longer suggest kids' parks)
 *   - parking lots / highway rest areas                     → DELETED
 *
 * Idempotent and checkpointed in api_cache ("fix-classification:progress",
 * 90 d TTL): a killed run resumes after the last committed id. Safe to
 * re-run - unchanged rows are skipped, so a second run is a no-op.
 *
 * Run:  npx tsx db/fix-classification.ts [--from-id N] [--batch 500]
 */
import { asc, eq, gt } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../api/queries/connection";
import { cacheGet, cacheSet } from "../api/lib/cache";
import { reclassifyStoredRow } from "../api/lib/classify-place";

const PROGRESS_KEY = "fix-classification:progress";
const PROGRESS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface Progress {
  lastId: number;
  scanned: number;
  updated: number;
  deleted: number;
  byKind: Record<string, number>;
}

function kindOf(before: { category: string }, after: { category: string } | "delete"): string {
  if (after === "delete") return "deleted-parking";
  if (before.category !== after.category) return `${before.category}→${after.category}`;
  return "tags/styles";
}

async function main() {
  const fromIdArg = process.argv.indexOf("--from-id");
  const batchArg = process.argv.indexOf("--batch");
  const batchSize = batchArg !== -1 ? Number(process.argv[batchArg + 1]) : 500;

  const prior = await cacheGet<Progress>(PROGRESS_KEY);
  let lastId = fromIdArg !== -1 ? Number(process.argv[fromIdArg + 1]) : (prior?.lastId ?? 0);
  const totals: Progress = {
    lastId,
    scanned: prior?.scanned ?? 0,
    updated: prior?.updated ?? 0,
    deleted: prior?.deleted ?? 0,
    byKind: prior?.byKind ?? {},
  };
  if (lastId > 0) {
    console.log(`[fix-classification] resuming after id ${lastId} (prior: scanned ${totals.scanned}, updated ${totals.updated}, deleted ${totals.deleted})`);
  }

  const db = getDb();
  for (;;) {
    const rows = await db
      .select()
      .from(schema.explorePlaces)
      .where(gt(schema.explorePlaces.id, lastId))
      .orderBy(asc(schema.explorePlaces.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      totals.scanned++;
      const before = {
        name: row.name,
        category: row.category,
        tags: row.tags ?? [],
        styles: row.styles ?? [],
      };
      const next = reclassifyStoredRow(before);
      if (next.action === "delete") {
        await db.delete(schema.explorePlaces).where(eq(schema.explorePlaces.id, row.id));
        totals.deleted++;
        const k = kindOf(before, "delete");
        totals.byKind[k] = (totals.byKind[k] ?? 0) + 1;
        console.log(`  [delete] #${row.id} ${row.name} (${row.city})`);
      } else {
        const changed =
          next.category !== row.category ||
          JSON.stringify(next.tags) !== JSON.stringify(row.tags ?? []) ||
          JSON.stringify(next.styles) !== JSON.stringify(row.styles ?? []);
        if (changed) {
          await db
            .update(schema.explorePlaces)
            .set({ category: next.category, tags: next.tags, styles: next.styles })
            .where(eq(schema.explorePlaces.id, row.id));
          totals.updated++;
          const k = kindOf(before, next);
          totals.byKind[k] = (totals.byKind[k] ?? 0) + 1;
        }
      }
      lastId = row.id;
    }

    totals.lastId = lastId;
    await cacheSet(PROGRESS_KEY, totals, PROGRESS_TTL_MS);
    console.log(
      `[fix-classification] …id ${lastId}: scanned ${totals.scanned}, updated ${totals.updated}, deleted ${totals.deleted}`,
    );
  }

  console.log("\n[fix-classification] DONE");
  console.log(`  scanned: ${totals.scanned}`);
  console.log(`  updated: ${totals.updated}`);
  console.log(`  deleted: ${totals.deleted}`);
  for (const [k, n] of Object.entries(totals.byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}: ${n}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`[fix-classification] FAILED, ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
