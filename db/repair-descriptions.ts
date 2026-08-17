/**
 * repair-descriptions.ts - restore explore_places.description values damaged
 * by the mangled sweep run (every '-' became ', ' in rows containing ', ').
 *
 * Strategy per row (sources of truth, all deterministic):
 *   - descriptionSource='composed'  → regenerate via composeDescription()
 *   - descriptionSource IS NULL     → restore from the seed sources in db/*.ts
 *                                     (same texts the seeders wrote originally)
 *   - curated/dbpedia/user          → em-dash sweep only; curated stories are
 *                                     re-imported from db/data JSON afterwards
 *
 * Idempotent. Run:  npx tsx db/repair-descriptions.ts
 */
import { sql } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { getDb } from "../api/queries/connection";
import { composeDescription } from "../api/lib/place-story";
import { normalizeNameKey } from "../api/lib/place-quality";

const EM = "—"; // written as escape so future codemods cannot mangle this file

function sweepEmDash(text: string): string {
  return text
    .split(` ${EM} `)
    .join(", ")
    .split(EM)
    .join("-")
    .replace(/,,/g, ",")
    .replace(/ ,/g, ",")
    .replace(/ \./g, ".")
    .replace(/ {2}/g, " ")
    .trim();
}

/** name (normalized) -> description, harvested from db/*.ts seed sources. */
function buildRestoreMap(): Map<string, string> {
  const map = new Map<string, string>();
  const dir = join(__dirname);
  for (const file of readdirSync(dir)) {
    if (!/^seed.*\.ts$/.test(file) || file.includes("repair") || file.includes("descriptions")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    // Format 1: object literals  { name: "X", ... description: "..." }
    for (const m of text.matchAll(/\{\s*name:\s*"((?:[^"\\]|\\.)*)"[\s\S]{0,600}?description:\s*"((?:[^"\\]|\\.)*)"/g)) {
      const name = m[1];
      const desc = m[2];
      const key = normalizeNameKey(name);
      if (key && desc && desc.length > 20) map.set(key, sweepEmDash(desc));
    }
    // Format 2: template calls  s("Name", lat, lng, dur, "description", {...})
    for (const m of text.matchAll(/\bs\("((?:[^"\\]|\\.)*)",\s*[-\d.]+,\s*[-\d.]+,\s*\d+,\s*"((?:[^"\\]|\\.)*)"/g)) {
      const name = m[1];
      const desc = m[2];
      const key = normalizeNameKey(name);
      if (key && desc && desc.length > 20 && !map.has(key)) map.set(key, sweepEmDash(desc));
    }
  }
  return map;
}

function quote(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

async function main() {
  const db = getDb();
  const restoreMap = buildRestoreMap();
  console.log(`[repair] restore map: ${restoreMap.size} seed descriptions harvested`);

  const rows = (await db.execute(
    sql.raw(
      `SELECT id, name, category, city, country, tags, rating, verdict, famousEatery, feeCents, feeCurrency, description, descriptionSource FROM explore_places WHERE description IS NOT NULL AND description != ''`,
    ),
  ))[0] as unknown as Array<Record<string, unknown>>;

  let regenerated = 0;
  let restored = 0;
  let emSwept = 0;
  let ok = 0;
  const unmatchedLegacy: string[] = [];
  for (const r of rows) {
    const current = String(r.description ?? "");
    const source = r.descriptionSource as string | null;
    let expected: string | null = null;
    let kind: "composed" | "restore" | "em" | null = null;

    if (source === "composed") {
      let tags: string[] | null = null;
      if (typeof r.tags === "string") {
        try {
          tags = JSON.parse(r.tags);
        } catch {
          tags = null;
        }
      } else if (Array.isArray(r.tags)) tags = r.tags as string[];
      expected = composeDescription({
        name: String(r.name),
        category: String(r.category ?? "activity"),
        city: String(r.city),
        country: String(r.country),
        tags,
        rating: r.rating == null ? null : Number(r.rating),
        verdict: (r.verdict as string | null) ?? null,
        famousEatery: r.famousEatery === 1 || r.famousEatery === true,
        feeCents: r.feeCents == null ? null : Number(r.feeCents),
        feeCurrency: (r.feeCurrency as string | null) ?? null,
      });
      kind = "composed";
    } else if (source == null) {
      const hit = restoreMap.get(normalizeNameKey(String(r.name)));
      if (hit) {
        expected = hit;
        kind = "restore";
      } else if (current.includes(EM)) {
        expected = sweepEmDash(current);
        kind = "em";
      } else {
        unmatchedLegacy.push(`${r.name} (${r.city})`);
      }
    } else if (current.includes(EM)) {
      expected = sweepEmDash(current);
      kind = "em";
    }

    if (expected == null || expected === current) {
      ok++;
      continue;
    }
    await db.execute(sql.raw(`UPDATE explore_places SET description = ${quote(expected)} WHERE id = ${Number(r.id)}`));
    if (kind === "composed") regenerated++;
    else if (kind === "restore") restored++;
    else emSwept++;
    if ((regenerated + restored + emSwept) % 500 === 0) {
      console.log(`[repair] ${regenerated + restored + emSwept} updated so far…`);
    }
  }
  console.log(
    `[repair] done: ${regenerated} regenerated, ${restored} restored-from-seed, ${emSwept} em-swept, ${ok} already ok (of ${rows.length})`,
  );
  if (unmatchedLegacy.length) {
    console.log(`[repair] legacy rows without a seed match (left as-is): ${unmatchedLegacy.length}`);
    console.log(unmatchedLegacy.slice(0, 20).join(" | "));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
