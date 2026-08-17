/**
 * seed-kidtags.ts - appends kid-suitability tags to explore_places so the AI
 * generator and the UI can rank/filter family picks:
 *
 *   kid-friendly - playgrounds, zoos, aquariums, theme/water parks, beaches,
 *                  parks, gardens, viewpoints, castles, train/science/
 *                  children's museums, animal anything, boat rides, towers
 *   kid-partial  - museums, landmarks, historic/religious sights, markets
 *                  (fine with older kids; keep visits short and playful)
 *   kid-avoid    - bars, nightlife, wine/whisky venues, adults-only
 *
 * Classification is the SHARED heuristic from contracts/kids.ts (category +
 * tags + name patterns like /playground|children|kids|zoo|aquarium/i), so
 * the seed, the API generator and the client badges all agree.
 *
 * IDEMPOTENT: rows that already carry the CORRECT kid-* tag are skipped;
 * existing (non-kid) tags and every other column are left untouched. Rows
 * whose kid-* tag disagrees with the current heuristic are RE-TAGGED (kid-*
 * tags are owned by this seed, so heuristics can evolve and re-runs converge);
 * a stale kid tag is dropped when the heuristic now says "neutral".
 *
 * Run:  npx tsx db/seed-kidtags.ts
 */
import { inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { kidClass, type KidClass } from "../contracts/kids";

const KID_TAGS: KidClass[] = ["kid-friendly", "kid-partial", "kid-avoid"];
const hasKidTag = (tags: string[]) => tags.some((t) => KID_TAGS.includes(t as KidClass));

/** MySQL/TiDB handles ~1000 ids per IN() comfortably - chunk the bulk updates. */
const CHUNK = 800;

async function main() {
  const db = getDb();
  const rows = await db.select().from(schema.explorePlaces);
  console.log(`[seed-kidtags] scanning ${rows.length} explore_places…`);

  const counts: Record<KidClass | "neutral" | "already" | "retagged" | "untagged", number> = {
    "kid-friendly": 0,
    "kid-partial": 0,
    "kid-avoid": 0,
    neutral: 0,
    already: 0,
    retagged: 0,
    untagged: 0,
  };
  // class → [{id, tags}] so each row gets its own tag list APPENDED to.
  const plan = new Map<KidClass, { id: number; tags: string[] }[]>();
  const retagPlan: { id: number; tags: string[] }[] = []; // full replacement lists
  const untagPlan: { id: number; tags: string[] }[] = []; // stale kid tag removed

  for (const row of rows) {
    const tags = (row.tags ?? []).map((t) => t.toLowerCase());
    // Classify WITHOUT the seeded kid-* tag so heuristic changes re-evaluate.
    const baseTags = (row.tags ?? []).filter((t) => !KID_TAGS.includes(t.toLowerCase() as KidClass));
    const cls = kidClass({
      name: row.name,
      category: row.category,
      tags: baseTags,
      priceLevel: row.priceLevel,
    });
    if (hasKidTag(tags)) {
      const current = tags.find((t) => KID_TAGS.includes(t as KidClass))!;
      if (current === cls) {
        counts.already++;
        continue;
      }
      if (cls === "neutral") {
        untagPlan.push({ id: row.id, tags: baseTags });
        counts.untagged++;
      } else {
        retagPlan.push({ id: row.id, tags: [...baseTags, cls] });
        counts.retagged++;
      }
      counts[cls]++;
      continue;
    }
    counts[cls]++;
    if (cls === "neutral") continue;
    const list = plan.get(cls) ?? [];
    list.push({ id: row.id, tags: [...baseTags, cls] });
    plan.set(cls, list);
  }

  // Every write is a full tags-list replacement: fresh appends + re-tags +
  // stale-tag removals, grouped by identical resulting tag list so each
  // UPDATE sets one literal over a chunk of ids.
  const replacements = [
    ...[...plan.values()].flat(),
    ...retagPlan,
    ...untagPlan,
  ];
  const byTags = new Map<string, { ids: number[]; tags: string[] }>();
  for (const item of replacements) {
    const key = JSON.stringify(item.tags);
    const bucket = byTags.get(key) ?? { ids: [], tags: item.tags };
    bucket.ids.push(item.id);
    byTags.set(key, bucket);
  }
  let updated = 0;
  for (const bucket of byTags.values()) {
    for (let i = 0; i < bucket.ids.length; i += CHUNK) {
      const ids = bucket.ids.slice(i, i + CHUNK);
      await db
        .update(schema.explorePlaces)
        .set({ tags: bucket.tags })
        .where(inArray(schema.explorePlaces.id, ids));
      updated += ids.length;
    }
  }
  for (const [cls, list] of plan) {
    console.log(`[seed-kidtags] ${cls}: ${list.length} places tagged`);
  }

  console.log(
    `[seed-kidtags] wrote ${updated} rows, ` +
      `kid-friendly: ${counts["kid-friendly"]}, ` +
      `kid-partial: ${counts["kid-partial"]}, ` +
      `kid-avoid: ${counts["kid-avoid"]}, ` +
      `neutral (untouched): ${counts.neutral}, ` +
      `already correct (skipped): ${counts.already}, ` +
      `re-tagged: ${counts.retagged}, ` +
      `stale tag removed: ${counts.untagged}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-kidtags] failed:", e);
  process.exit(1);
});
