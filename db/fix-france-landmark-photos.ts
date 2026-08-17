/**
 * fix-france-landmark-photos.ts (r16-france) - targeted photo fix for the
 * France corpus' highest-value places whose EDITORIAL names don't match a
 * Wikipedia/DBpedia article title ("Eiffel Tower Summit", "Sacré-Cœur &
 * Montmartre"). The bulk DBpedia pass (seed-photos-france.ts) keys on the raw
 * corpus name, so these miss. Here we derive a BASE name (strip trailing
 * descriptors: " Summit", " & …", parentheticals) and look THAT up, updating
 * the row when the base article yields a thumbnail.
 *
 * Only processes must-see / famousEatery France rows still lacking a real
 * photo - i.e. the places most worth fixing. Best-effort (DBpedia rate-limits).
 *
 * Run: npx tsx db/fix-france-landmark-photos.ts
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { dbpediaPhotosForBatch } from "./seed-photos";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strip editorial descriptors to a likely Wikipedia article title. */
function baseName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/g, " ") // drop parentheticals
    .replace(/\s*&\s.*$/, "") // drop " & Montmartre" and beyond
    .replace(/\s+(Summit|Rooftop|Terrace|Viewpoint|Observation Deck|Tower Top)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function main() {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT id, name, city FROM explore_places
    WHERE country='France' AND (image IS NULL OR image LIKE '/%')
      AND (verdict='must-see' OR famousEatery=1)
    ORDER BY (verdict='must-see') DESC, rating DESC LIMIT 60`);
  const rows = (Array.isArray(res) ? res[0] : res) as unknown as { id: number; name: string; city: string }[];
  console.log(`[landmark-photos] ${rows.length} photo-less must-see/famous France rows`);

  let fixed = 0, tried = 0;
  for (const r of rows) {
    const base = baseName(r.name);
    if (base === r.name || base.length < 4) continue; // only when a base differs
    tried++;
    try {
      // Look up the BASE name but tag it with the row id so we can update it.
      const hits = await dbpediaPhotosForBatch([{ id: r.id, name: base, city: r.city }]);
      const hit = hits.get(Number(r.id));
      if (hit) {
        await db.update(schema.explorePlaces)
          .set({ image: hit.image, photoSource: "wikipedia", photoAttribution: hit.attribution })
          .where(eq(schema.explorePlaces.id, r.id));
        fixed++;
        console.log(`  FIX "${r.name}" ← base "${base}" → ${hit.image.slice(0, 80)}`);
      } else {
        console.log(`  miss "${r.name}" (base "${base}")`);
      }
    } catch (e) {
      console.warn(`  err "${r.name}": ${e instanceof Error ? e.message : e}`);
      await sleep(30_000); // DBpedia rate-limit backoff
    }
    await sleep(10_000); // respect the rate limit
  }
  console.log(`[landmark-photos] done, base-name tried ${tried}, fixed ${fixed}`);
  process.exit(0);
}

main().catch((e) => { console.error("[landmark-photos] FAILED:", e); process.exit(1); });
