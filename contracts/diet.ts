/**
 * Dietary preferences + veg/vegan restaurant signals - shared by the server
 * generator (food-pick ranking in trip-router) and the client (diet badges
 * on place cards / detail dialog / suggestion rows).
 *
 * Signal sources, in descending reliability:
 *  1. OSM diet/cuisine tags captured at import ("diet:vegetarian=yes",
 *     "diet:vegan=only", "cuisine=vegetarian", …) - sparse but explicit.
 *  2. Name heuristics ("Pure Veg", "Shakahari", "Vegan…", "Steakhouse…").
 *  3. Region priors (applied by the generator, e.g. India pure-veg boost).
 * Tag coverage IS sparse - classification is best-effort and the generator
 * degrades gracefully (marks relaxed picks "veg options unverified").
 */

export type Dietary = "non-veg" | "veg" | "vegan" | "eggetarian" | "jain";

export const DIETARIES: readonly Dietary[] = ["non-veg", "veg", "vegan", "eggetarian", "jain"];

/** Quiz card row + profile chips: emoji + label per dietary choice. */
export const DIET_META: Record<Dietary, { label: string; emoji: string }> = {
  "non-veg": { label: "Non-veg", emoji: "🍗" },
  veg: { label: "Vegetarian", emoji: "🌱" },
  vegan: { label: "Vegan", emoji: "🥗" },
  eggetarian: { label: "Eggetarian", emoji: "🧀" },
  jain: { label: "Jain", emoji: "🌿" },
};

/** Normalize a stored/unknown dietary string (DB default is 'non-veg'). */
export function parseDietary(v: string | null | undefined): Dietary {
  return (DIETARIES as readonly string[]).includes(v ?? "") ? (v as Dietary) : "non-veg";
}

/** Dietary choices that constrain restaurant picks (anything but non-veg). */
export function isVegDiet(d: Dietary): boolean {
  return d !== "non-veg";
}

export interface DietPlaceLike {
  name?: string | null;
  category?: string | null;
  tags?: (string | null)[] | null;
  country?: string | null;
}

/** Food-ish categories (mirrors the generator's FOOD_CATEGORIES + stop cats). */
const FOOD_CATS = new Set(["food", "restaurant", "cafe", "bar"]);
export const isFoodPlace = (p: DietPlaceLike) =>
  FOOD_CATS.has((p.category ?? "").toLowerCase()) ||
  (p.tags ?? []).some((t) => (t ?? "").toLowerCase() === "food");

// ── Signal vocabularies ─────────────────────────────────────────────────────
/** Veg-identity names: the restaurant IS vegetarian/vegan. */
const VEG_NAME_RE = /\b(vegetarian|veggie|vegan|shakahari|saatvik|satvik|jain|ahimsa|govinda'?s?)\b/i;
/** "Pure veg" phrasing - the strong India signal. */
const PURE_VEG_NAME_RE = /\b(pure\s*veg|shudh\s*shakahari|shudh|saatvik|satvik)\b/i;
/** Obvious meat-only names (mission: steakhouse, bbq, seafood + close kin). */
const MEAT_ONLY_NAME_RE =
  /\b(steakhouse|steak\s*house|bbq|bar-?b-?que|barbecue|smokehouse|churrascaria|rodizio|seafood|fish\s*&\s*chips|rib\s*shack)\b/i;
/** Jain excludes root vegetables - best-effort name filter only. */
const ROOT_VEG_NAME_RE = /\b(potato|onion|garlic|ginger|root\s*veg|tuber)\b/i;

/** cuisine= values that mean the kitchen is vegetarian/vegan. */
const VEG_CUISINE_RE = /(^|[;\s,])(vegetarian|vegan)([;\s,]|$)/i;
const VEGAN_CUISINE_RE = /(^|[;\s,])vegan([;\s,]|$)/i;
/** cuisine= values that are obviously meat-only. */
const MEAT_ONLY_CUISINE_RE = /(^|[;\s,])(steak|seafood|bbq|barbecue|churrasco|fish)([;\s,]|$)/i;

function tagsOf(p: DietPlaceLike): string[] {
  return (p.tags ?? []).filter((t): t is string => !!t).map((t) => t.toLowerCase());
}

/** Value of a "key=value" style tag ("diet:vegan=yes" → "yes"), else null. */
function tagValue(tags: string[], key: string): string | null {
  for (const t of tags) {
    if (t.startsWith(`${key}=`)) return t.slice(key.length + 1).trim().toLowerCase();
  }
  return null;
}

/** All values carried by a repeatable "key=v1;v2" tag family (e.g. cuisine). */
function tagValues(tags: string[], key: string): string[] {
  return tags.filter((t) => t.startsWith(`${key}=`)).map((t) => t.slice(key.length + 1).trim().toLowerCase());
}

const YES = new Set(["yes", "only", "true", "1"]);

export type DietClass = "pure-veg" | "vegan" | "veg-friendly" | "meat-only" | "neutral";

/**
 * Classify one place by veg signals. Precedence: explicit OSM diet/cuisine
 * tags → "pure veg"/veg-identity names → meat-only heuristics → neutral.
 * A positive veg tag always beats a meat-looking name (tagged veg options
 * at a grill house are still veg options).
 */
export function dietClass(p: DietPlaceLike): DietClass {
  const tags = tagsOf(p);
  const name = (p.name ?? "").trim();

  const vegTag = tagValue(tags, "diet:vegetarian");
  const veganTag = tagValue(tags, "diet:vegan");
  const cuisines = tagValues(tags, "cuisine");
  const vegCuisine = cuisines.some((c) => VEG_CUISINE_RE.test(c));
  const veganCuisine = cuisines.some((c) => VEGAN_CUISINE_RE.test(c));
  const meatCuisine = cuisines.some((c) => MEAT_ONLY_CUISINE_RE.test(c));

  // 1) Whole-menu veg signals → "pure-veg" / "vegan".
  if (veganTag === "only" || veganCuisine || tags.includes("vegan")) return "vegan";
  if (vegTag === "only" || vegCuisine || tags.includes("pure-veg")) return "pure-veg";
  if (PURE_VEG_NAME_RE.test(name)) return "pure-veg";
  if (VEG_NAME_RE.test(name)) return /\bvegan\b/i.test(name) ? "vegan" : "veg-friendly";

  // 2) "Options" tags - some of the menu fits.
  if (veganTag != null && YES.has(veganTag)) return "vegan";
  if (vegTag != null && YES.has(vegTag)) return "veg-friendly";

  // 3) Obvious meat-only (name or cuisine) with no positive signal above.
  if (MEAT_ONLY_NAME_RE.test(name) || meatCuisine || tags.includes("steakhouse")) return "meat-only";

  return "neutral";
}

/** Obvious meat-only venue (steakhouse/bbq/seafood…) - excluded for veg diets. */
export function isMeatOnly(p: DietPlaceLike): boolean {
  return dietClass(p) === "meat-only";
}

/**
 * How well a place fits a dietary choice (0 = no confirmed fit):
 *   vegan      → 3 vegan, 2 pure-veg/veg-friendly (dairy risk), 0 unknown
 *   veg/egget. → 3 pure-veg/vegan, 2 veg-friendly, 0 unknown
 *   jain       → 3 jain-signalled, 2 pure-veg/vegan, 1 veg-friendly,
 *                0 anything with root-veg in the name (best-effort)
 *   non-veg    → unconstrained (2 meat-only, 1 anything else)
 */
export function dietFit(p: DietPlaceLike, dietary: Dietary): number {
  if (dietary === "non-veg") return isMeatOnly(p) ? 2 : 1;
  const cls = dietClass(p);
  if (cls === "meat-only") return 0;
  const name = (p.name ?? "").trim();
  const tags = tagsOf(p);
  switch (dietary) {
    case "vegan":
      return cls === "vegan" ? 3 : cls === "pure-veg" ? 2 : cls === "veg-friendly" ? 2 : 0;
    case "veg":
    case "eggetarian":
      return cls === "pure-veg" || cls === "vegan" ? 3 : cls === "veg-friendly" ? 2 : 0;
    case "jain": {
      if (ROOT_VEG_NAME_RE.test(name)) return 0;
      if (/\bjain\b/i.test(name) || tags.includes("jain")) return 3;
      return cls === "pure-veg" || cls === "vegan" ? 2 : cls === "veg-friendly" ? 1 : 0;
    }
  }
}

/** Confirmed diet fit (fit ≥ 2) - a pick the day can stand behind. */
export function dietConfirmed(p: DietPlaceLike, dietary: Dietary): boolean {
  return dietary === "non-veg" || dietFit(p, dietary) >= 2;
}

export type DietBadgeKind = "pure-veg" | "vegan" | "veg-friendly";
export interface DietBadge {
  label: string;
  kind: DietBadgeKind;
}

/**
 * Small diet badge for food places ("Pure veg" | "Vegan options" |
 * "Veg-friendly"), derived from tags/name. null when nothing is known or
 * the place isn't food - never badge a meat-only or unknown kitchen.
 */
export function dietBadge(p: DietPlaceLike): DietBadge | null {
  if (!isFoodPlace(p)) return null;
  const cls = dietClass(p);
  if (cls === "pure-veg") return { label: "Pure veg", kind: "pure-veg" };
  if (cls === "vegan") return { label: "Vegan options", kind: "vegan" };
  if (cls === "veg-friendly") return { label: "Veg-friendly", kind: "veg-friendly" };
  return null;
}

/** Stop-note suffix when a veg-diet food pick had to relax (thin corpus). */
export const DIET_UNVERIFIED_NOTE = "veg options unverified";
