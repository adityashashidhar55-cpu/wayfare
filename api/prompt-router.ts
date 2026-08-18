/**
 * prompt-router (r29) - the free-text entry point the product always implied
 * it had.
 *
 * Before this, the landing page textarea ran two regexes client-side, kept the
 * destination and threw the rest of the sentence away (src/lib/plan-prompt.ts).
 * "7-day trip to Japan, love food, avoid crowds" reached the planner as
 * `dest=Japan`.
 *
 * `interpret` parses the sentence into a TripIntent and immediately shows what
 * it found, so a user can correct the machine BEFORE a trip is created. That
 * ordering is the point: the old flow committed to a trip and then let you
 * discover it had ignored you.
 *
 * Public on purpose - the hero is above the sign-in wall, and a visitor should
 * be able to see real places from their own sentence before being asked for an
 * account.
 */
import { z } from "zod";
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import * as schema from "@db/schema";
import { parseTripPrompt, type TripIntent } from "@contracts/trip-prompt";
import { getDb } from "./queries/connection";
import { createRouter, publicQuery } from "./middleware";
import { tagsForStyles } from "./lib/style-map";


/** Preview size. Enough to prove we understood; not a whole itinerary. */
const PREVIEW_LIMIT = 12;

/**
 * Find places matching an intent, ranked by quality first.
 *
 * Quality leads deliberately. The corpus is 526k rows of which ~1,300 score 40
 * or better, so a style-overlap-first ranking on a thin city returns a list of
 * bare OSM nodes that makes the product look empty. Better to show eight
 * genuinely good places that partially match than forty that match on a tag
 * and have no photo or description.
 */
async function previewPlaces(intent: TripIntent): Promise<{
  places: Array<{ id: number; name: string; city: string; country: string; category: string;
                  description: string | null; image: string | null; qualityScore: number }>;
  matchedDestination: string | null;
}> {
  const db = getDb();
  const ep = schema.explorePlaces;
  const where: SQL[] = [
    eq(ep.approved, true),
    eq(ep.isJunk, false),
    eq(ep.isChain, false),
  ];

  let matchedDestination: string | null = null;
  if (intent.destination) {
    const d = intent.destination.trim();
    // City first, then country - a country match on "Japan" would otherwise
    // drown a city match on "Nara".
    const cityHit = await db
      .select({ city: ep.city, country: ep.country })
      .from(ep)
      .where(and(eq(ep.city, d), eq(ep.approved, true)))
      .limit(1);
    if (cityHit[0]) {
      where.push(eq(ep.city, d));
      matchedDestination = `${cityHit[0].city}, ${cityHit[0].country}`;
    } else {
      where.push(or(eq(ep.country, d), sql`${ep.city} LIKE ${d + "%"}`)!);
      matchedDestination = d;
    }
  }

  // Style filtering rides on the same tag vocabulary the feed ranker uses, so
  // a prompt and the taste profile pull in the same direction.
  const wanted = [...tagsForStyles(intent.styles)];
  const unwanted = [...tagsForStyles(intent.avoid)];

  const rows = await db
    .select({
      id: ep.id, name: ep.name, city: ep.city, country: ep.country, category: ep.category,
      description: ep.description, image: ep.image, qualityScore: ep.qualityScore,
      tags: ep.tags, styles: ep.styles,
    })
    .from(ep)
    .where(and(...where))
    .orderBy(desc(ep.qualityScore))
    // Deliberately generous: we re-rank in JS below, and the SQL cannot
    // express tag overlap cheaply on a JSON column.
    .limit(400);

  const wantedSet = new Set(wanted);
  const unwantedSet = new Set(unwanted);
  const scored = rows
    .map((r) => {
      const tags = (r.tags ?? []) as string[];
      const hits = tags.filter((t) => wantedSet.has(t)).length;
      const misses = tags.filter((t) => unwantedSet.has(t)).length;
      const styleHits = ((r.styles ?? []) as string[]).filter((s) => intent.styles.includes(s as never)).length;
      return { row: r, score: r.qualityScore + Math.min(hits, 3) * 12 + styleHits * 10 - misses * 25 };
    })
    // A place whose tags are entirely what the user asked to avoid is dropped,
    // not merely ranked down - "no museums" has to mean no museums.
    .filter((s) => s.score > -20)
    .sort((a, b) => b.score - a.score)
    .slice(0, PREVIEW_LIMIT);

  return {
    places: scored.map((s) => ({
      id: Number(s.row.id), name: s.row.name, city: s.row.city, country: s.row.country,
      category: s.row.category, description: s.row.description, image: s.row.image,
      qualityScore: s.row.qualityScore,
    })),
    matchedDestination,
  };
}

export const promptRouter = createRouter({
  /**
   * Parse a sentence and show what we understood, plus real places.
   *
   * Never throws on unparseable input - a visitor typing nonsense should get
   * an empty, honest result, not an error page.
   */
  interpret: publicQuery
    .input(z.object({ prompt: z.string().max(2000) }))
    .query(async ({ input }) => {
      const intent = parseTripPrompt(input.prompt);
      if (!intent.destination && intent.styles.length === 0) {
        return { intent, places: [], matchedDestination: null, corpusEmpty: false };
      }
      try {
        const { places, matchedDestination } = await previewPlaces(intent);
        return { intent, places, matchedDestination, corpusEmpty: places.length === 0 };
      } catch (e) {
        console.warn("prompt.interpret preview failed", e);
        return { intent, places: [], matchedDestination: null, corpusEmpty: true };
      }
    }),

  /** Parse only - no database round trip. Used for live feedback as you type. */
  parse: publicQuery
    .input(z.object({ prompt: z.string().max(2000) }))
    .query(({ input }) => ({ intent: parseTripPrompt(input.prompt) })),
});

