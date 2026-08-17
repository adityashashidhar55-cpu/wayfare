/**
 * import-place-stories.ts (r18-stories) - import curated, agent-authored
 * place stories from db/data/place-stories-*.json into explore_places.
 *
 * Each entry: { name, city, country, lat?, lng?, category?, story }.
 *
 * Matching (per entry, within the same city+country):
 *   - normalized-name match (equal, or one contains the other, min 4 chars);
 *   - when the entry carries coords, the name match must ALSO be within
 *     0.5 km (haversine) - a same-named place across town is a different
 *     place, so a distant match counts as NO match.
 *
 * On match  → UPDATE description=story, descriptionSource='curated'.
 *             Curated stories are owner-authored canon and ALWAYS overwrite.
 * No match + coords → INSERT a curated row (category from JSON or
 *             'activity', rating 4.5, source='curated', verdict='must-see'
 *             when name/category imply historic worship/fort/palace/monument).
 * No match + no coords → log skip (can't place it on the map honestly).
 *
 * IDEMPOTENT: re-running re-applies the same updates; inserted rows match
 * themselves on the next run. Safe alongside the world seeder.
 *
 * Run:  npx tsx db/import-place-stories.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { normalizeNameKey } from "../api/lib/place-quality";

const DATA_DIR = path.join(import.meta.dirname, "data");
const MATCH_RADIUS_KM = 0.5;

interface StoryEntry {
  name: string;
  city: string;
  country: string;
  lat?: number;
  lng?: number;
  category?: string;
  story: string;
}

/** Historic/worship cues that earn a curated newcomer a must-see verdict. */
const MUST_SEE_RE = /\b(temple|church|mosque|shrine|cathedral|chapel|gurudwara|gurdwara|synagogue|monastery|pagoda|fort|palace|monument|castle|ruins?|heritage|historic|memorial)\b/i;

/**
 * Derive explore_places.tags for a story entry from its name/category - 
 * iconicityOf() (the fame-score multiplier) is tag-driven, so a curated
 * temple with NULL tags ranked BELOW tagged OSM temples in "Most famous".
 * Conservative: only well-known keyword buckets, max 2 tags.
 */
export function tagsForEntry(entry: { name: string; category?: string }): string[] {
  const hay = ` ${entry.name.toLowerCase()} ${(entry.category ?? "").toLowerCase()} `;
  const tags: string[] = [];
  const push = (t: string) => {
    if (!tags.includes(t)) tags.push(t);
  };
  if (/\b(temple|kovil|mandir|shrine|mosque|church|chapel|cathedral|basilica|gurudwara|gurdwara|synagogue|monastery|pagoda|stupa|vihara)\b/.test(hay)) {
    push(
      hay.includes("church") || hay.includes("chapel") || hay.includes("cathedral") || hay.includes("basilica")
        ? "church"
        : hay.includes("mosque")
          ? "mosque"
          : "temple",
    );
    push("historic");
  }
  if (/\b(fort|palace|castle|citadel)\b/.test(hay)) {
    push(hay.includes("palace") ? "palace" : hay.includes("castle") ? "castle" : "fort");
    push("historic");
  }
  if (/\b(monument|memorial|tomb|mausoleum|samadhi)\b/.test(hay)) {
    push("monument");
    push("historic");
  }
  if (/\b(ruins?|heritage|historic)\b/.test(hay)) push("historic");
  if (/\b(museum|gallery)\b/.test(hay)) push("museum");
  if (/\b(tower|gate|gateway|bridge|arch|statue|pillar|minar)\b/.test(hay)) push("landmark");
  if (/\b(beach|falls|waterfall|lake|ghat|ghats|rock|peak|mount|canyon|garden|park|backwaters?|island)\b/.test(hay)) {
    push("nature");
  }
  return tags.slice(0, 2);
}

/** Great-circle distance in km. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Normalized-name match: equal or containment, min 4 chars (place-quality convention). */
function nameMatches(entryKey: string, candidateName: string): boolean {
  const candKey = normalizeNameKey(candidateName);
  // Short names ("Oia") only match EXACTLY - a substring rule would
  // over-match; but refusing to match at all makes re-runs insert
  // duplicates (idempotency requires exact short-name equality).
  if (entryKey.length < 4 || candKey.length < 4) return entryKey === candKey && entryKey.length > 0;
  return entryKey === candKey || entryKey.includes(candKey) || candKey.includes(entryKey);
}

export function loadStoryFiles(dir = DATA_DIR): { file: string; entries: StoryEntry[] }[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^place-stories-.*\.json$/i.test(f));
  } catch {
    return [];
  }
  const out: { file: string; entries: StoryEntry[] }[] = [];
  for (const file of files.sort()) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as unknown;
      const entries = (Array.isArray(parsed) ? parsed : []).filter(
        (e): e is StoryEntry =>
          Boolean(e) &&
          typeof (e as StoryEntry).name === "string" &&
          typeof (e as StoryEntry).city === "string" &&
          typeof (e as StoryEntry).country === "string" &&
          typeof (e as StoryEntry).story === "string",
      );
      out.push({ file, entries });
    } catch (e) {
      console.warn(`[import-stories] WARNING: could not parse ${file}, ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

export interface ImportSummary {
  total: number;
  updated: number;
  inserted: number;
  skipped: number;
  failed: number;
}

/** Apply every db/data/place-stories-*.json entry. Idempotent - see header. */
export async function importStories(): Promise<ImportSummary> {
  const files = loadStoryFiles();
  if (!files.length) {
    console.log("[import-stories] no db/data/place-stories-*.json files found, nothing to do");
    return { total: 0, updated: 0, inserted: 0, skipped: 0, failed: 0 };
  }
  const total = files.reduce((n, f) => n + f.entries.length, 0);
  console.log(`[import-stories] ${files.length} file(s), ${total} stories: ${files.map((f) => f.file).join(", ")}`);

  const db = getDb();
  let updated = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const { file, entries } of files) {
    for (const entry of entries) {
      const label = `${entry.name} (${entry.city}, ${entry.country}) [${file}]`;
      try {
        const entryKey = normalizeNameKey(entry.name);
        const candidates = await db
          .select({
            id: schema.explorePlaces.id,
            name: schema.explorePlaces.name,
            lat: schema.explorePlaces.lat,
            lng: schema.explorePlaces.lng,
            tags: schema.explorePlaces.tags,
          })
          .from(schema.explorePlaces)
          .where(
            and(
              eq(schema.explorePlaces.city, entry.city),
              eq(schema.explorePlaces.country, entry.country),
            ),
          );
        const named = candidates.filter((c) => nameMatches(entryKey, c.name));

        let match: (typeof named)[number] | null = null;
        if (entry.lat != null && entry.lng != null) {
          // Coords given: only a name match within 0.5 km is the same place.
          let bestKm = Infinity;
          for (const c of named) {
            if (c.lat == null || c.lng == null) continue;
            const km = haversineKm(entry.lat, entry.lng, c.lat, c.lng);
            if (km < bestKm) {
              bestKm = km;
              match = c;
            }
          }
          if (match && bestKm > MATCH_RADIUS_KM) match = null;
        } else {
          match = named[0] ?? null;
        }

        if (match) {
          const patch: Record<string, unknown> = {
            description: entry.story,
            descriptionSource: "curated",
          };
          // Backfill tags when the row has none - iconicityOf (fame ranking)
          // is tag-driven; a curated story place must not rank below tag
          // carrying OSM rows in its own city.
          if (!match.tags || match.tags.length === 0) {
            const t = tagsForEntry(entry);
            if (t.length) patch.tags = t;
          }
          await db
            .update(schema.explorePlaces)
            .set(patch)
            .where(eq(schema.explorePlaces.id, match.id));
          updated++;
          console.log(`[import-stories] UPDATE #${match.id} ${label}`);
        } else if (entry.lat != null && entry.lng != null) {
          const category = entry.category?.trim() || "activity";
          const mustSee = MUST_SEE_RE.test(`${entry.name} ${category}`);
          const tags = tagsForEntry(entry);
          await db.insert(schema.explorePlaces).values({
            name: entry.name,
            city: entry.city,
            country: entry.country,
            lat: entry.lat,
            lng: entry.lng,
            category,
            tags: tags.length ? tags : null,
            rating: 4.5,
            source: "curated",
            verdict: mustSee ? "must-see" : null,
            description: entry.story,
            descriptionSource: "curated",
          });
          inserted++;
          console.log(`[import-stories] INSERT ${label}${mustSee ? " (must-see)" : ""}`);
        } else {
          skipped++;
          console.log(`[import-stories] SKIP (no match, no coords) ${label}`);
        }
      } catch (e) {
        failed++;
        console.error(`[import-stories] FAIL ${label}, ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  console.log(
    `[import-stories] COMPLETE, updated ${updated}, inserted ${inserted}, skipped ${skipped}, failed ${failed} (of ${total})`,
  );
  return { total, updated, inserted, skipped, failed };
}

// Run standalone (npx tsx db/import-place-stories.ts) - but stay importable
// for db/seed-suchindram.ts, which reuses importStories() after deep-import.
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  importStories()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[import-stories] fatal", e);
      process.exit(1);
    });
}
