/**
 * seed-cafes-india-photos.ts (r16-india) - attach Wikipedia photos to the
 * curated famous cafés that HAVE a Wikipedia article, by resolving the
 * article's DBpedia resource directly (dbo:wikiPageRedirects{0,1} →
 * dbo:thumbnail). The generic backfill guesses DBpedia titles from place
 * names and misses these ("Mavalli Tiffin Room (MTR)" ≠ the article
 * "Mavalli Tiffin Rooms"), so the Wikipedia-title mapping is curated here.
 *
 * Thumbnails are canonicalized to commons Special:FilePath?width=800 (same
 * convention as db/seed-photos.ts) and stored with photoSource='wikipedia'.
 * Idempotent: rows that already hold an external image are skipped.
 *
 * Run:  npx tsx db/seed-cafes-india-photos.ts
 */
import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { fetchJson } from "../api/lib/http";

const USER_AGENT = "Wayfare/1.0 (travel app; india cafe photos; +https://wayfare.app)";
const DBPEDIA_SPARQL = "https://dbpedia.org/sparql";

/** rowName (exact explore_places.name) → Wikipedia article title. Cities
 * listed explicitly unless the photo fits every branch of the name. */
const WIKI: { name: string; title: string; cities?: string[] }[] = [
  { name: "Mavalli Tiffin Room (MTR)", title: "Mavalli Tiffin Rooms" },
  { name: "Indian Coffee House", title: "Indian Coffee House" },
  { name: "Flurys", title: "Flurys" },
  { name: "Cafe Mondegar", title: "Café Mondegar" },
  { name: "Leopold Cafe", title: "Leopold Cafe" },
  { name: "Vidyarthi Bhavan", title: "Vidyarthi Bhavan" },
];

interface SparqlBinding {
  thumb: { value: string };
}

/** Resolve one article title → commons thumbnail URL (FilePath?width=800). */
async function dbpediaThumb(title: string): Promise<string | null> {
  const iri = `http://dbpedia.org/resource/${title.replace(/\s+/g, "_")}`;
  const query = `SELECT ?thumb WHERE {
  <${iri}> <http://dbpedia.org/ontology/wikiPageRedirects>{0,1} ?target .
  ?target <http://dbpedia.org/ontology/thumbnail> ?thumb .
} LIMIT 1`;
  const url = `${DBPEDIA_SPARQL}?query=${encodeURIComponent(query)}&format=${encodeURIComponent("application/sparql-results+json")}`;
  try {
    const data = await fetchJson<{ results?: { bindings?: SparqlBinding[] } }>(url, {
      userAgent: USER_AGENT,
      service: "dbpedia",
      timeoutMs: 30000,
      headers: { Accept: "application/sparql-results+json" },
    });
    const raw = data.results?.bindings?.[0]?.thumb.value;
    if (!raw) return null;
    const m = /Special:FilePath\/([^?]+)/.exec(raw);
    if (!m) return null;
    const canon = `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1]}?width=800`;
    return canon.length <= 500 ? canon : null;
  } catch (e) {
    console.warn(`[cafe-photos] dbpedia error for "${title}": ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function main() {
  const db = getDb();
  let updated = 0;
  for (const w of WIKI) {
    const image = await dbpediaThumb(w.title);
    if (!image) {
      console.log(`[cafe-photos] no thumbnail for "${w.title}" (${w.name})`);
      continue;
    }
    const needsImage = or(isNull(schema.explorePlaces.image), like(schema.explorePlaces.image, "/%"));
    const where = and(
      eq(schema.explorePlaces.country, "India"),
      eq(schema.explorePlaces.name, w.name),
      needsImage,
      w.cities && w.cities.length > 0 ? sql`${schema.explorePlaces.city} IN (${sql.join(w.cities.map((c) => sql`${c}`), sql`, `)})` : undefined,
    );
    const res = await db
      .update(schema.explorePlaces)
      .set({ image, photoSource: "wikipedia", photoAttribution: "Wikimedia Commons" })
      .where(where);
    const n = Number((res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
    updated += n;
    console.log(`[cafe-photos] ${w.name} ← "${w.title}": ${n} row(s)`);
  }
  console.log(`[cafe-photos] done: ${updated} rows updated`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[cafe-photos] FAILED:", e);
    process.exit(1);
  });
}
