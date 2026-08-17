/**
 * Shared place classification vocabulary (r15-places).
 *
 * Pure data + helpers, DB-free, imported by every importer/normalizer
 * (api/queries/overpass.ts, api/queries/coverage.ts, api/citybuild-router.ts),
 * the repair script (db/fix-classification.ts) and the tests:
 *
 *  1. MARKET REGEXES - the prepared-food vs produce/wholesale marketplace
 *     vocabulary (moved here from api/queries/overpass.ts so the stored-row
 *     reclassifier shares the exact same rules as the OSM importers).
 *
 *  2. FUN CATEGORIES - the waterpark / themepark / games taxonomy. OSM
 *     leisure/tourism values → new explore_places categories + corpus tags
 *     ("water-park", "theme-park", "rides", "arcade", "go-kart", …).
 *
 *  3. reclassifyStoredRow - re-derives category/tags/styles for an EXISTING
 *     explore_places row from its stored name/tags (the original OSM tags
 *     are not persisted). db/fix-classification.ts runs it over the corpus;
 *     importers' normalizers must stay consistent with it.
 */

import { isParkingLikeName } from "./place-quality";

// ─── marketplace vocabulary ──────────────────────────────────────────────────

// amenity=marketplace covers everything from hawker centres to wholesale
// vegetable mandis. Blanket-mapping all of them to 'food' is how "vegetable
// markets" ended up suggested as restaurants - only prepared-food markets are
// food; produce/wholesale/ambiguous markets are 'shopping'.
export const PREPARED_FOOD_MARKET_RE =
  /(food[\s-]?(court|centre|center)|hawker|street[\s-]?food|night[\s-]?market|food[\s-]?hall|food[\s-]?market|food\s+bazaar|eater(y|ies))/i;
export const PRODUCE_MARKET_RE =
  /(vegetable|veggie|sabzi|mandi|produce|wholesale|fish|meat|flower|fruit|wet[\s-]?market|farmers?['\s-]?market|spice|grain)/i;

/** Names that read as a market/bazaar (used to spot misfiled market rows). */
export const MARKET_NAME_RE = /market|bazaar|bazar|souk|souq|mercado|mercato|markt|march[eé]|ichiba|bajaar/i;

// ─── fun categories (waterpark / themepark / games) ─────────────────────────

export type FunCategory = "waterpark" | "themepark" | "games";

/** leisure= values that map to the "games" category, with their corpus tag. */
export const GAMES_LEISURE: Record<string, string> = {
  amusement_arcade: "arcade",
  escape_game: "escape-room",
  go_kart: "go-kart",
  paintball: "paintball",
  bowling_alley: "bowling",
  laser_tag: "laser-tag",
};

/**
 * Map OSM tourism/leisure values to a fun category + corpus tag, or null.
 *   leisure=water_park      → waterpark ("water-park")
 *   tourism=theme_park      → themepark ("theme-park")
 *   leisure=amusement_arcade|escape_game|go_kart|paintball|bowling_alley|…
 *                           → games ("arcade" | "escape-room" | …)
 */
export function funCategoryFor(input: { tourism?: string; leisure?: string }): {
  category: FunCategory;
  tag: string;
} | null {
  if (input.leisure === "water_park") return { category: "waterpark", tag: "water-park" };
  if (input.tourism === "theme_park") return { category: "themepark", tag: "theme-park" };
  const gameTag = input.leisure ? GAMES_LEISURE[input.leisure] : undefined;
  if (gameTag) return { category: "games", tag: gameTag };
  return null;
}

// ─── stored-row reclassification (db/fix-classification.ts) ─────────────────

export interface StoredRow {
  name: string;
  category: string;
  tags: string[] | null;
  styles: string[] | null;
}

export type ReclassifyResult =
  | { action: "delete" }
  | { action: "keep"; category: string; tags: string[]; styles: string[] };

const WATERPARK_NAME_RE =
  /water[\s-]?park|aqua[\s-]?park|waterworld|splash\s?(world|land|kingdom|zone)|water\s?kingdom/i;
const THEMEPARK_NAME_RE =
  /theme[\s-]?park|amusement[\s-]?park|funfair|fun[\s-]?fair|disney|universal\s+studios|legoland|roller\s?coaster|wonderla|imagica|ramoji|essl?[\s-]?world|fun\s?city|adventure\s?(park|land|world|island)|thrill/i;
const GAMES_NAME_RE =
  /go[-\s]?kart|paintball|bowling|escape\s?room|arcade\s?(game|zone|parlo(u)?r)|gaming\s?zone|laser\s?tag|video\s?game\s?parlo(u)?r/i;
const ZOO_NAME_RE =
  /\bzoo\b|zoological|aquarium|safari\s?park|petting|aviary|bird\s?park|deer\s?park|children'?s\s?park|kids?\s?park|playground/i;

const has = (tags: string[], t: string) => tags.includes(t);
const without = (tags: string[], drop: string[]) => tags.filter((t) => !drop.includes(t));

function uniqPush(list: string[], t: string, cap: number): string[] {
  const out = list.includes(t) ? list : [...list, t];
  return out.slice(0, cap);
}

/**
 * Re-derive category/tags/styles for a stored explore_places row under the
 * CURRENT classifier rules. Returns {action:"delete"} for rows that must not
 * exist at all (parking lots, rest areas); otherwise the corrected triple.
 * Idempotent - rows already correct come back with identical values, so the
 * caller updates only on a real diff.
 */
export function reclassifyStoredRow(row: StoredRow): ReclassifyResult {
  const name = row.name ?? "";
  const tags = (row.tags ?? []).map((t) => t.toLowerCase());
  const styles = (row.styles ?? []).map((s) => s.toLowerCase());
  const cat = row.category.toLowerCase();

  // 1. parking lots / rest areas are never places - delete the row.
  if (isParkingLikeName(name) || cat === "parking") return { action: "delete" };

  // 2. produce/wholesale/ambiguous markets misfiled as food → shopping.
  //    Requires market evidence (the "market" tag from import, or a market-y
  //    name) so Arabic "mandi" restaurants and "The Vegetable"-type names
  //    stay untouched; prepared-food markets (hawker/food court/night
  //    market) stay food.
  const marketish = has(tags, "market") || MARKET_NAME_RE.test(name);
  if (
    cat === "food" &&
    marketish &&
    !PREPARED_FOOD_MARKET_RE.test(name) &&
    (PRODUCE_MARKET_RE.test(name) || has(tags, "market") || MARKET_NAME_RE.test(name))
  ) {
    let nextTags = without(tags, ["food", "restaurant", "cafe"]);
    nextTags = uniqPush(nextTags, "market", 4);
    nextTags = uniqPush(nextTags, "shopping", 4);
    return {
      action: "keep",
      category: "shopping",
      tags: nextTags,
      styles: without(styles, ["food"]),
    };
  }

  // 3. thrill venues → the new fun categories. Only claim rows currently in
  //    generic buckets (activity/adventure, or family-tagged) - never steal
  //    rows already classified food/shopping/historic/natural.
  const claimable =
    cat === "activity" || cat === "adventure" || has(tags, "family") || has(tags, "playground");
  if (claimable) {
    const fun: { category: FunCategory; tag: string } | null = WATERPARK_NAME_RE.test(name)
      ? { category: "waterpark", tag: "water-park" }
      : THEMEPARK_NAME_RE.test(name)
        ? { category: "themepark", tag: "theme-park" }
        : GAMES_NAME_RE.test(name)
          ? { category: "games", tag: "games" }
          : null;
    if (fun) {
      let nextTags = fun.category === "games" ? without(tags, ["family", "playground"]) : tags;
      nextTags = uniqPush(nextTags, fun.tag, 4);
      if (fun.category !== "games") nextTags = uniqPush(nextTags, "rides", 4);
      else nextTags = uniqPush(nextTags, "games", 4);
      // Thrill venues are legit adventure matches (style-map r15); keep any
      // existing "family" style but guarantee "adventure" is present.
      let nextStyles = styles.includes("adventure") ? styles : [...styles, "adventure"];
      nextStyles = nextStyles.slice(0, 2);
      return { action: "keep", category: fun.category, tags: nextTags, styles: nextStyles };
    }
  }

  // 4. zoos/aquariums/playgrounds are family, never adventure - drop a stale
  //    "adventure" style (pre-r15 importers assigned it to tourism=zoo).
  //    Thrill venues were already claimed by rule 3, so any remaining
  //    family-tagged row is kids' stuff.
  if (
    styles.includes("adventure") &&
    (ZOO_NAME_RE.test(name) || has(tags, "playground") || has(tags, "family"))
  ) {
    const nextStyles = without(styles, ["adventure"]);
    return {
      action: "keep",
      category: row.category,
      tags,
      styles: uniqPush(nextStyles, "family", 2),
    };
  }

  return { action: "keep", category: row.category, tags, styles };
}
